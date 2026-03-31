from django.urls import path
from . import views

urlpatterns = [
    path("", views.PostListView.as_view(), name="post_list"),
    path("posts/create/", views.post_create, name="post_create"),
    path("posts/<int:pk>/delete/", views.post_delete, name="post_delete"),
]
