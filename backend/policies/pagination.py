# backend/policies/pagination.py
from rest_framework.pagination import PageNumberPagination


class DefaultPageNumberPagination(PageNumberPagination):
    """
    Paginación estándar para endpoints del módulo policies.
    Compatible con FE:
      - page (1-based)
      - page_size
    Respuesta:
      { count, next, previous, results }
    """
    page_query_param = "page"
    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 100
