from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Player
from .services import ClaimConflictError, ClaimService, InvalidAnonIdError, PlayerService

User = get_user_model()

ANON = "7c9e6679-7425-40de-944b-e07fc1f90ae7"


class PlayerServiceTest(APITestCase):
    def test_get_or_create_is_idempotent(self):
        p1 = PlayerService.get_or_create(ANON)
        p2 = PlayerService.get_or_create(ANON)
        self.assertEqual(p1.id, p2.id)
        self.assertEqual(Player.objects.count(), 1)

    def test_invalid_anon_id_raises(self):
        with self.assertRaises(InvalidAnonIdError):
            PlayerService.get_or_create("not-a-uuid")


class ClaimServiceTest(APITestCase):
    def setUp(self):
        self.user_a = User.objects.create_user("a", password="irrelevant1")
        self.user_b = User.objects.create_user("b", password="irrelevant1")

    def test_claim_creates_then_idempotent(self):
        p = ClaimService.claim(self.user_a, ANON)
        self.assertEqual(p.user_id, self.user_a.id)
        p2 = ClaimService.claim(self.user_a, ANON)
        self.assertEqual(p.id, p2.id)

    def test_claim_conflict(self):
        ClaimService.claim(self.user_a, ANON)
        with self.assertRaises(ClaimConflictError):
            ClaimService.claim(self.user_b, ANON)


class AuthAPITest(APITestCase):
    def test_register_then_obtain_token(self):
        resp = self.client.post(
            "/api/auth/register/", {"username": "u1", "password": "supersecret123"}
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        resp = self.client.post(
            "/api/auth/token/", {"username": "u1", "password": "supersecret123"}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("access", resp.data)

    def test_claim_endpoint(self):
        User.objects.create_user("u1", password="supersecret123")
        token = self.client.post(
            "/api/auth/token/", {"username": "u1", "password": "supersecret123"}
        ).data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        resp = self.client.post("/api/auth/claim/", {"anon_id": ANON})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data["claimed"])

    def test_claim_requires_auth(self):
        resp = self.client.post("/api/auth/claim/", {"anon_id": ANON})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
