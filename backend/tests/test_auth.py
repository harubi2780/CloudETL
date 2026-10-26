import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import Client, TestCase, override_settings


@override_settings(ALLOWED_HOSTS=["testserver"])
class AuthApiTests(TestCase):
    password = "Strong-Clover-Horse-94!"

    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)

    def csrf_token(self):
        response = self.client.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrftoken", self.client.cookies)
        return response.json()["csrfToken"]

    def post_json(self, path, data=None, token=None, origin="http://testserver"):
        headers = {"HTTP_ORIGIN": origin} if origin else {}
        if token:
            headers["HTTP_X_CSRFTOKEN"] = token
        raw = "" if data is None else json.dumps(data)
        return self.client.post(
            path, data=raw, content_type="application/json", **headers
        )

    def registration_payload(self, **overrides):
        payload = {
            "username": "river",
            "email": "river@example.com",
            "password": self.password,
            "password_confirmation": self.password,
        }
        payload.update(overrides)
        return payload

    def test_csrf_token_and_anonymous_profile(self):
        response = self.client.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"csrfToken"})
        self.assertTrue(response.json()["csrfToken"])
        self.assertTrue(response.headers["Cache-Control"].find("no-store") >= 0)

        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(
            response.json(),
            {"error": {"code": "authentication_required", "message": "Please log in."}},
        )

    def test_registration_logs_in_regular_user_and_logout_invalidates_old_session(self):
        session = self.client.session
        session["preauth"] = "value"
        session.save()
        initial_session_key = session.session_key
        token = self.csrf_token()
        initial_csrf_cookie = self.client.cookies["csrftoken"].value

        response = self.post_json(
            "/api/auth/register/", self.registration_payload(), token=token
        )
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(set(body), {"user", "csrfToken"})
        self.assertEqual(set(body["user"]), {"id", "username", "email"})
        self.assertEqual(body["user"]["username"], "river")
        self.assertEqual(body["user"]["email"], "river@example.com")
        self.assertNotIn("password", json.dumps(body))

        user = get_user_model().objects.get(username="river")
        self.assertTrue(user.check_password(self.password))
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertNotEqual(self.client.session.session_key, initial_session_key)
        self.assertNotEqual(self.client.cookies["csrftoken"].value, initial_csrf_cookie)
        self.assertEqual(self.client.get("/api/auth/me/").json()["user"], body["user"])

        stale_client = Client()
        stale_client.cookies["sessionid"] = self.client.cookies["sessionid"].value
        self.assertEqual(stale_client.get("/api/auth/me/").status_code, 200)

        csrf_cookie_before_logout = self.client.cookies["csrftoken"].value
        response = self.post_json(
            "/api/auth/logout/", token=body["csrfToken"]
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"user", "csrfToken"})
        self.assertIsNone(response.json()["user"])
        self.assertTrue(response.json()["csrfToken"])
        self.assertNotEqual(
            self.client.cookies["csrftoken"].value, csrf_cookie_before_logout
        )
        self.assertEqual(stale_client.get("/api/auth/me/").status_code, 401)

        # The refreshed token works for a later login, and logout is idempotent.
        response = self.post_json(
            "/api/auth/login/",
            {"username": "river", "password": self.password},
            token=response.json()["csrfToken"],
        )
        self.assertEqual(response.status_code, 200)
        response = self.post_json(
            "/api/auth/logout/", token=response.json()["csrfToken"]
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["user"])

    def test_login_returns_generic_error_for_wrong_missing_and_inactive_users(self):
        user_model = get_user_model()
        user_model.objects.create_user(
            username="active", email="active@example.com", password=self.password
        )
        user_model.objects.create_user(
            username="inactive", email="inactive@example.com", password=self.password,
            is_active=False,
        )

        errors = []
        for username, password in (
            ("active", "Wrong-Clover-Horse-94!"),
            ("missing", self.password),
            ("inactive", self.password),
        ):
            token = self.csrf_token()
            response = self.post_json(
                "/api/auth/login/", {"username": username, "password": password}, token
            )
            self.assertEqual(response.status_code, 401)
            errors.append(response.json())
        self.assertEqual(errors[0], errors[1])
        self.assertEqual(errors[1], errors[2])
        self.assertEqual(
            errors[0],
            {
                "error": {
                    "code": "invalid_credentials",
                    "message": "Username or password is incorrect.",
                }
            },
        )

        initial_csrf_cookie = self.client.cookies["csrftoken"].value
        token = self.csrf_token()
        session = self.client.session
        session["preauth"] = "value"
        session.save()
        old_session_key = session.session_key
        response = self.post_json(
            "/api/auth/login/", {"username": "active", "password": self.password}, token
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["user"]["id"], user_model.objects.get(username="active").pk
        )
        self.assertNotEqual(self.client.session.session_key, old_session_key)
        self.assertNotEqual(self.client.cookies["csrftoken"].value, initial_csrf_cookie)
        self.assertTrue(response.json()["csrfToken"])

    def test_login_rejects_non_string_and_unexpected_fields(self):
        for payload in (
            {"username": None, "password": self.password},
            {"username": "river", "password": ["not", "a", "string"]},
            {"username": "river", "password": self.password, "is_staff": True},
        ):
            token = self.csrf_token()
            response = self.post_json("/api/auth/login/", payload, token)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["error"]["code"], "validation_error")
            self.assertIn("fields", response.json()["error"])

    def test_password_validators_run_and_password_whitespace_is_preserved(self):
        for username, password in (("common", "password"), ("short", "abc")):
            token = self.csrf_token()
            response = self.post_json(
                "/api/auth/register/",
                self.registration_payload(
                    username=username,
                    email=f"{username}@example.com",
                    password=password,
                    password_confirmation=password,
                ),
                token,
            )
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["error"]["code"], "validation_error")

        spaced_password = f"  {self.password}  "
        token = self.csrf_token()
        response = self.post_json(
            "/api/auth/register/",
            self.registration_payload(
                username="spaced",
                email="spaced@example.com",
                password=spaced_password,
                password_confirmation=spaced_password,
            ),
            token,
        )
        self.assertEqual(response.status_code, 201)
        user = get_user_model().objects.get(username="spaced")
        self.assertTrue(user.check_password(spaced_password))
        self.assertFalse(user.check_password(spaced_password.strip()))

    def test_registration_validation_malformed_json_types_and_unknown_flags(self):
        token = self.csrf_token()
        response = self.client.post(
            "/api/auth/register/", data="{", content_type="application/json",
            HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="http://testserver",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_json")

        for data in (
            [],
            self.registration_payload(username=None),
            self.registration_payload(username="u" * 151),
            self.registration_payload(email=f"{'a' * 250}@example.com"),
            self.registration_payload(username="\ud800"),
            self.registration_payload(password="\ud800", password_confirmation="\ud800"),
            self.registration_payload(password="x" * 1025, password_confirmation="x" * 1025),
            self.registration_payload(is_superuser=True),
            self.registration_payload(password_confirmation="Different-password-97!"),
            self.registration_payload(email="invalid-email"),
        ):
            token = self.csrf_token()
            response = self.post_json("/api/auth/register/", data, token)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["error"]["code"], "validation_error")
            self.assertIn("fields", response.json()["error"])

        self.assertFalse(get_user_model().objects.filter(username="river").exists())

        token = self.csrf_token()
        response = self.post_json("/api/auth/register/", self.registration_payload(), token)
        self.assertEqual(response.status_code, 201)
        token = response.json()["csrfToken"]
        response = self.post_json("/api/auth/logout/", token=token)
        self.assertEqual(response.status_code, 200)
        token = response.json()["csrfToken"]
        response = self.post_json(
            "/api/auth/register/", self.registration_payload(email="other@example.com"), token
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_csrf_is_required_bad_origin_fails_and_admin_uses_default_failure_page(self):
        response = self.post_json("/api/auth/login/", {"username": "x", "password": "y"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "csrf_failed")

        token = self.csrf_token()
        response = self.post_json(
            "/api/auth/register/", self.registration_payload(), token,
            origin="https://attacker.example",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "csrf_failed")
        self.assertNotIn("attacker.example", response.content.decode())

        response = self.client.post(
            "/admin/login/", {"username": "x", "password": "y"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("text/html", response["Content-Type"])

    def test_methods_return_json_405_with_allow_header(self):
        response = self.client.get("/api/auth/login/")
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response["Allow"], "POST")

        token = self.csrf_token()
        response = self.post_json("/api/auth/csrf/", token=token)
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response["Allow"], "GET")
        self.assertEqual(response.json()["error"]["code"], "method_not_allowed")

        response = self.client.get("/api/auth/logout/")
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response["Allow"], "POST")

    def test_authenticated_user_cannot_silently_switch_accounts(self):
        user_model = get_user_model()
        current = user_model.objects.create_user(
            username="current", email="current@example.com", password=self.password
        )
        self.client.force_login(current)

        token = self.csrf_token()
        response = self.post_json(
            "/api/auth/login/",
            {"username": "other", "password": self.password},
            token,
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "already_authenticated")

        token = self.csrf_token()
        response = self.post_json(
            "/api/auth/register/", self.registration_payload(username="newuser"), token
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "already_authenticated")
        self.assertEqual(self.client.get("/api/auth/me/").json()["user"]["id"], current.pk)

    def test_login_normalizes_username_like_registration(self):
        username = "  \uff52\uff49\uff56\uff45\uff52  "
        response = self.post_json(
            "/api/auth/register/",
            self.registration_payload(username=username),
            self.csrf_token(),
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user"]["username"], "river")
        response = self.post_json("/api/auth/logout/", token=response.json()["csrfToken"])
        response = self.post_json(
            "/api/auth/login/",
            {"username": username, "password": self.password},
            response.json()["csrfToken"],
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["username"], "river")

    def test_regular_account_cannot_access_admin_and_deactivation_ends_access(self):
        response = self.post_json(
            "/api/auth/register/", self.registration_payload(), self.csrf_token()
        )
        self.assertEqual(response.status_code, 201)
        response = self.client.get("/admin/")
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.url.startswith("/admin/login/"))

        user = get_user_model().objects.get(username="river")
        user.is_active = False
        user.save(update_fields=["is_active"])
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "authentication_required")

    def test_registration_rejects_password_similar_to_username(self):
        username = "Matching-Username-Example-94"
        response = self.post_json(
            "/api/auth/register/",
            self.registration_payload(
                username=username,
                password=username,
                password_confirmation=username,
            ),
            self.csrf_token(),
        )
        self.assertEqual(response.status_code, 400)
        fields = response.json()["error"]["fields"]
        messages = [message for errors in fields.values() for message in errors]
        self.assertTrue(any("similar" in message.lower() for message in messages))
        self.assertFalse(get_user_model().objects.filter(username=username).exists())

    def test_duplicate_insert_race_returns_safe_error_and_leaves_transaction_usable(self):
        token = self.csrf_token()
        with patch(
            "services.auth_service.create_user",
            side_effect=IntegrityError("simulated duplicate insert"),
        ):
            response = self.post_json(
                "/api/auth/register/", self.registration_payload(), token
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("username", response.json()["error"]["fields"])
        self.assertNotIn("simulated duplicate insert", response.content.decode())
        self.assertFalse(get_user_model().objects.filter(username="river").exists())

        response = self.post_json(
            "/api/auth/register/", self.registration_payload(), token
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(get_user_model().objects.get(username="river").check_password(self.password))
