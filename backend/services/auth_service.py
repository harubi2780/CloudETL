from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.forms import UsernameField
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.middleware.csrf import rotate_token

from dao.user_dao import create_user
from forms import RegistrationForm


class AuthServiceError(Exception):
    """A safe authentication error that the HTTP layer can serialize."""

    def __init__(self, status, code, message, fields=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields


def _already_authenticated(request):
    if request.user.is_authenticated:
        raise AuthServiceError(409, "already_authenticated", "You are already logged in.")


def _form_errors(form):
    names = {
        "password1": "password",
        "password2": "password_confirmation",
        "__all__": "password",
    }
    return {
        names.get(field, field): [str(message) for message in messages]
        for field, messages in form.errors.items()
    }


def register_account(request, payload):
    _already_authenticated(request)
    form = RegistrationForm(
        data={
            "username": payload["username"],
            "email": payload["email"],
            "password1": payload["password"],
            "password2": payload["password_confirmation"],
        }
    )
    if not form.is_valid():
        raise AuthServiceError(
            400, "validation_error", "Please check the form.", _form_errors(form)
        )

    try:
        with transaction.atomic():
            user = create_user(
                username=form.cleaned_data["username"],
                email=form.cleaned_data["email"],
                password=form.cleaned_data["password1"],
            )
    except IntegrityError as error:
        raise AuthServiceError(
            400,
            "validation_error",
            "Please check the form.",
            {"username": ["A user with that username already exists."]},
        ) from error

    login(request, user)
    return user


def login_account(request, payload):
    _already_authenticated(request)
    try:
        username = UsernameField(max_length=150).clean(payload["username"])
    except ValidationError as error:
        raise AuthServiceError(
            400,
            "validation_error",
            "Please check the form.",
            {"username": error.messages},
        ) from error

    user = authenticate(request, username=username, password=payload["password"])
    if user is None:
        raise AuthServiceError(
            401, "invalid_credentials", "Username or password is incorrect."
        )
    login(request, user)
    return user


def public_profile(user):
    return {"id": user.pk, "username": user.get_username(), "email": user.email or ""}


def current_profile(request):
    if not request.user.is_authenticated:
        raise AuthServiceError(401, "authentication_required", "Please log in.")
    return public_profile(request.user)


def logout_account(request):
    logout(request)
    rotate_token(request)
