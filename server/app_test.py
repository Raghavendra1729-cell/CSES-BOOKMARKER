import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from server.app import app
from server.reviewer import _response_format, validate_review


class HealthEndpointTest(unittest.TestCase):
    def test_health_reports_the_actual_default_router_configuration(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HF_BASE_URL", None)
            response = TestClient(app).get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model"], "MiniMaxAI/MiniMax-M3:fireworks-ai")
        self.assertEqual(response.json()["base_url"], "https://router.huggingface.co/v1")


class ReviewContractTest(unittest.TestCase):
    def test_server_uses_supported_strict_json_schema(self):
        response_format = _response_format(True)
        schema = response_format["json_schema"]["schema"]
        self.assertEqual(response_format["type"], "json_schema")
        self.assertTrue(response_format["json_schema"]["strict"])
        self.assertNotIn("maxItems", schema["properties"]["approaches"])

    def test_server_rejects_extra_fields_from_a_rejected_review(self):
        problem = validate_review(
            {"verdict_summary": "Wrong answer.", "tiny_hint": "Check the edge.", "extra": "no"},
            accepted=False,
        )
        self.assertEqual(problem, "Rejected review has unexpected fields.")


if __name__ == "__main__":
    unittest.main()
