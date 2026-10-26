"""URL configuration for CloudETL."""

from django.contrib import admin
from django.urls import include, path

import views
from datasets import views as dataset_views

auth_patterns = (
    [
        path("csrf/", views.csrf_token, name="csrf"),
        path("register/", views.register, name="register"),
        path("login/", views.login_view, name="login"),
        path("me/", views.me, name="me"),
        path("logout/", views.logout_view, name="logout"),
    ],
    "accounts",
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include(auth_patterns, namespace="accounts")),
    path("api/datasets/", dataset_views.collection, name="datasets"),
]
