from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Player

from .models import FeedbackTicket, TicketStatus
from .services import FeedbackService, InvalidTransitionError, TicketWorkflowService

ANON = "7c9e6679-7425-40de-944b-e07fc1f90ae7"


class FeedbackSubmitTest(APITestCase):
    def test_submit_creates_ticket_and_player(self):
        resp = self.client.post(
            "/api/feedback/",
            {
                "anon_id": ANON,
                "category": "crash",
                "title": "第三关 Boss 死亡后黑屏",
                "description": "击败后黑屏",
                "repro_steps": "进第三关->击败Boss->黑屏",
                "client_version": "0.3.1",
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Player.objects.count(), 1)
        ticket = FeedbackTicket.objects.get()
        self.assertEqual(ticket.status, TicketStatus.SUBMITTED)
        self.assertEqual(str(ticket.player.anon_id), ANON)

    def test_missing_anon_id_rejected(self):
        resp = self.client.post(
            "/api/feedback/",
            {"category": "crash", "title": "t", "description": "d", "client_version": "0.3.1"},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class WorkflowTest(APITestCase):
    def setUp(self):
        self.ticket = FeedbackService.create_ticket(
            ANON,
            category="crash",
            severity="high",
            title="t",
            description="d",
            client_version="0.3.1",
        )

    def test_happy_path(self):
        t = self.ticket
        TicketWorkflowService.classify(t)
        self.assertEqual(t.status, TicketStatus.CLASSIFIED)
        TicketWorkflowService.start_processing(t)
        TicketWorkflowService.verify(t)
        TicketWorkflowService.close(t)
        self.assertEqual(t.status, TicketStatus.CLOSED)
        self.assertIsNotNone(t.closed_at)

    def test_verify_can_fall_back_to_processing(self):
        t = self.ticket
        TicketWorkflowService.classify(t)
        TicketWorkflowService.start_processing(t)
        TicketWorkflowService.verify(t)
        TicketWorkflowService.start_processing(t)  # 验证不通过退回
        self.assertEqual(t.status, TicketStatus.PROCESSING)

    def test_invalid_transition_rejected(self):
        with self.assertRaises(InvalidTransitionError):
            TicketWorkflowService.close(self.ticket)  # submitted 不能直接 close
