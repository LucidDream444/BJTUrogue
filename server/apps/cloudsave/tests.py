from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from .models import CloudSave

User = get_user_model()


def profile(revision=1, coins=120):
    return {
        "schemaVersion": 1,
        "revision": revision,
        "settings": {"bgmVolume": 0.6, "sfxVolume": 0.8, "displayMode": "fullscreen"},
        "unlocks": {"characters": ["freshman"], "skills": []},
        "currency": {"coins": coins},
        "upgrades": {"freshman": 3},
        "stats": {"runs": 4, "wins": 1, "deaths": 3, "bestDepth": 2},
        "selected": {"characterId": "freshman", "difficulty": "normal"},
    }


class CloudSaveAPITest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("s", password="supersecret123")
        self.client.force_authenticate(self.user)

    def upload(self, p=None, base_revision=0):
        return self.client.put(
            "/api/profile/save/",
            {"base_revision": base_revision, "profile": p or profile()},
            format="json",
        )

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        resp = self.client.get("/api/profile/save/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_get_empty_returns_404(self):
        resp = self.client.get("/api/profile/save/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_upload_creates_then_get(self):
        resp = self.upload()
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["revision"], 1)
        self.assertEqual(resp.data["schema_version"], 1)
        resp = self.client.get("/api/profile/save/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["payload"]["currency"]["coins"], 120)

    def test_upload_advances_revision(self):
        self.upload()
        resp = self.upload(p=profile(revision=2, coins=200), base_revision=1)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["revision"], 2)
        self.assertEqual(CloudSave.objects.get().payload["currency"]["coins"], 200)

    def test_upload_conflicts_on_stale_base_revision(self):
        self.upload()  # 云端 revision 1
        self.upload(p=profile(revision=2, coins=300), base_revision=1)  # 云端 revision 2
        resp = self.upload(p=profile(revision=3, coins=400), base_revision=1)  # 过期 base
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.data["revision"], 2)

    def test_upload_rejects_missing_schema_version(self):
        p = profile()
        del p["schemaVersion"]
        resp = self.upload(p=p)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete(self):
        self.upload()
        resp = self.client.delete("/api/profile/save/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(CloudSave.objects.count(), 0)
