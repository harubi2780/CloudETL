from django.urls import path

from . import views

urlpatterns = [
    path("", views.overview, name="billing-overview"),
    path("demo/orders/", views.orders, name="billing-demo-orders"),
    path("demo/orders/<uuid:order_id>/complete/", views.complete, name="billing-demo-complete"),
    path("demo/expire/", views.expire, name="billing-demo-expire"),
]
