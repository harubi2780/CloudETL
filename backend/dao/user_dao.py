from django.contrib.auth import get_user_model


def create_user(username, email, password):
    """Create a regular account, delegating password hashing to Django."""
    user_model = get_user_model()
    return user_model.objects.create_user(
        username=username,
        email=email,
        password=password,
        is_staff=False,
        is_superuser=False,
    )
