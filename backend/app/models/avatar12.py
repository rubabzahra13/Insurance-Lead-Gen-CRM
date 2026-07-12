from __future__ import annotations

import enum
import uuid

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class AvatarType(str, enum.Enum):
    avatar1 = "avatar1"
    avatar2 = "avatar2"


class AvatarLead(Base):
    __tablename__ = "avatar12_lead"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    avatar_type: Mapped[AvatarType] = mapped_column(
        Enum(AvatarType, name="avatar12_type", native_enum=True),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    headline: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str | None] = mapped_column(Text)
    past_experience: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    company: Mapped[str | None] = mapped_column(Text)
    linkedin_url: Mapped[str | None] = mapped_column(Text)
    search_prompt: Mapped[str | None] = mapped_column(Text)
    source_snapshot: Mapped[str | None] = mapped_column(Text)
    source_query: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[str] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    drafts = relationship("LeadDraft", back_populates="avatar_lead", cascade="all, delete-orphan")
    funnel_events = relationship("FunnelEvent", back_populates="avatar_lead", cascade="all, delete-orphan")


class LeadDraft(Base):
    __tablename__ = "lead_draft"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    avatar12_lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("avatar12_lead.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="draft")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    reasoning: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    avatar_lead = relationship("AvatarLead", back_populates="drafts")


class FunnelEventType(str, enum.Enum):
    link_clicked = "link_clicked"
    form_started = "form_started"
    form_submitted = "form_submitted"
    meeting_booked = "meeting_booked"


class FunnelEvent(Base):
    __tablename__ = "avatar12_funnel_event"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    avatar12_lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("avatar12_lead.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[FunnelEventType] = mapped_column(
        Enum(FunnelEventType, name="avatar12_funnel_event_type", native_enum=True),
        nullable=False,
    )
    payload: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    avatar_lead = relationship("AvatarLead", back_populates="funnel_events")
