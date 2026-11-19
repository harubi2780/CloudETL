from django.urls import path

from . import views

urlpatterns = [
    path("capabilities/", views.capabilities, name="etl-capabilities"),
    path("datasets/<uuid:dataset_id>/preview/", views.dataset_preview, name="etl-dataset-preview"),
    path("datasets/<uuid:dataset_id>/", views.dataset_detail, name="etl-source"),
    path("runs/", views.runs, name="etl-runs"),
    path("runs/<uuid:run_id>/", views.run_detail, name="etl-run-detail"),
    path("runs/<uuid:run_id>/download/", views.download, name="etl-download"),
    path("runs/<uuid:run_id>/rows/", views.rows, name="etl-result-rows"),
    path("runs/<uuid:run_id>/result/", views.result_file, name="etl-result-file"),
]
