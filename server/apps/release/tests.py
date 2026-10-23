from django.test import TestCase

from .models import Release, ReleaseStatus
from .services import ReleaseService


class ReleaseServiceTest(TestCase):
    def test_release_and_rollback(self):
        r = Release.objects.create(version="1.2.3", artifact_path="/game/v1.2.3/")
        ReleaseService.mark_verified(r)
        self.assertEqual(r.status, ReleaseStatus.VERIFIED)
        ReleaseService.release(r)
        self.assertEqual(r.status, ReleaseStatus.RELEASED)

        r2 = Release.objects.create(version="1.2.4", artifact_path="/game/v1.2.4/")
        ReleaseService.mark_verified(r2)
        ReleaseService.release(r2, previous=r)
        self.assertEqual(r2.previous, r)

        back = ReleaseService.rollback(r2)
        self.assertEqual(r2.status, ReleaseStatus.ROLLED_BACK)
        self.assertEqual(back, r)

    def test_cannot_release_unverified(self):
        r = Release.objects.create(version="1.2.5", artifact_path="/game/v1.2.5/")
        with self.assertRaises(ValueError):
            ReleaseService.release(r)

    def test_cannot_rollback_without_previous(self):
        r = Release.objects.create(version="1.2.6", artifact_path="/game/v1.2.6/")
        ReleaseService.mark_verified(r)
        ReleaseService.release(r)
        with self.assertRaises(ValueError):
            ReleaseService.rollback(r)
