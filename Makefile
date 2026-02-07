SHELL := /bin/bash

.PHONY: test-metrics-prod

test-metrics-prod:
	./venv/bin/python manage.py test common.tests.test_metrics.MetricsEndpointProdTest
