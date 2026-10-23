"""模块 A 业务逻辑：反馈创建 + 工单状态机流转。"""
from django.utils import timezone

from apps.accounts.services import PlayerService

from .models import FeedbackCategory, FeedbackSeverity, FeedbackTicket, TicketStatus


class InvalidTransitionError(Exception):
    """状态机不允许本次流转。"""


class FeedbackService:
    @staticmethod
    def create_ticket(
        anon_id,
        *,
        title,
        description,
        client_version,
        category=FeedbackCategory.OTHER,
        severity=FeedbackSeverity.LOW,
        repro_steps="",
        client_platform="",
        attachment=None,
    ) -> FeedbackTicket:
        player = PlayerService.get_or_create(anon_id)
        return FeedbackTicket.objects.create(
            player=player,
            category=category,
            severity=severity,
            title=title,
            description=description,
            repro_steps=repro_steps,
            client_version=client_version,
            client_platform=client_platform,
            attachment=attachment,
        )


class TicketWorkflowService:
    """工单状态机唯一入口。流转规则集中于此，可在 Admin 与单测复用。"""

    TRANSITIONS = {
        TicketStatus.SUBMITTED: {TicketStatus.CLASSIFIED},
        TicketStatus.CLASSIFIED: {TicketStatus.PROCESSING},
        TicketStatus.PROCESSING: {TicketStatus.VERIFIED},
        TicketStatus.VERIFIED: {TicketStatus.PROCESSING, TicketStatus.CLOSED},
        TicketStatus.CLOSED: set(),
    }

    @classmethod
    def allowed_transitions(cls, status):
        return cls.TRANSITIONS.get(TicketStatus(status), set())

    @classmethod
    def _transition(cls, ticket, target):
        if TicketStatus(target) not in cls.allowed_transitions(ticket.status):
            raise InvalidTransitionError(f"不允许从 {ticket.status} 流转到 {target}")
        ticket.status = target
        if target == TicketStatus.CLOSED:
            ticket.closed_at = timezone.now()
        ticket.save()

    @classmethod
    def classify(cls, ticket, category=None, severity=None):
        if category is not None:
            ticket.category = category
        if severity is not None:
            ticket.severity = severity
        cls._transition(ticket, TicketStatus.CLASSIFIED)

    @classmethod
    def start_processing(cls, ticket):
        cls._transition(ticket, TicketStatus.PROCESSING)

    @classmethod
    def verify(cls, ticket):
        cls._transition(ticket, TicketStatus.VERIFIED)

    @classmethod
    def close(cls, ticket):
        cls._transition(ticket, TicketStatus.CLOSED)
