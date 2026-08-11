import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from server.app import app


class HealthEndpointTest(unittest.TestCase):
    def test_health_reports_the_actual_default_router_configuration(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HF_BASE_URL", None)
            response = TestClient(app).get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model"], "MiniMaxAI/MiniMax-M3:novita")
        self.assertEqual(response.json()["base_url"], "https://router.huggingface.co/v1")


if __name__ == "__main__":
    unittest.main()
