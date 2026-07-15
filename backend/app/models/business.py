from __future__ import annotations

import enum
import uuid

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PipelineStage(str, enum.Enum):
    new = "new"
    qualified = "qualified"
    warm = "warm"
    follow_up_later = "follow_up_later"
    sealed_won = "sealed_won"
    lost = "lost"
    not_interested = "not_interested"


class InteractionChannel(str, enum.Enum):
    email = "email"
    phone = "phone"
    whatsapp = "whatsapp"
    in_person = "in_person"
    other = "other"


class InteractionDirection(str, enum.Enum):
    inbound = "inbound"
    outbound = "outbound"


class PipelineEventType(str, enum.Enum):
    stage_change = "stage_change"
    note_added = "note_added"
    follow_up_generated = "follow_up_generated"


class BusinessLead(Base):
    __tablename__ = "business_lead"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(Text)
    google_place_id: Mapped[str | None] = mapped_column(String(255))
    rating: Mapped[str | None] = mapped_column(String(32))
    open_status: Mapped[str | None] = mapped_column(String(64))
    phone: Mapped[str | None] = mapped_column(String(64))
    owner_name: Mapped[str | None] = mapped_column(String(255))
    manager_name: Mapped[str | None] = mapped_column(String(255))
    contact_email: Mapped[str | None] = mapped_column(String(255))
    contact_linkedin: Mapped[str | None] = mapped_column(Text)
    pipeline_stage: Mapped[PipelineStage] = mapped_column(
        Enum(PipelineStage, name="pipeline_stage", native_enum=True),
        nullable=False,
        server_default=PipelineStage.new.value,
    )
    source_query: Mapped[str | None] = mapped_column(Text)
    image_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[str] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    notes = relationship("BusinessNote", back_populates="business_lead", cascade="all, delete-orphan")
    interactions = relationship("BusinessInteraction", back_populates="business_lead", cascade="all, delete-orphan")
    follow_up_plans = relationship("FollowUpPlan", back_populates="business_lead", cascade="all, delete-orphan")
    pipeline_events = relationship("PipelineEvent", back_populates="business_lead", cascade="all, delete-orphan")


class BusinessNote(Base):
    __tablename__ = "business_note"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("business_lead.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    business_lead = relationship("BusinessLead", back_populates="notes")


class BusinessInteraction(Base):
    __tablename__ = "business_interaction"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("business_lead.id", ondelete="CASCADE"), nullable=False
    )
    channel: Mapped[InteractionChannel] = mapped_column(
        Enum(InteractionChannel, name="interaction_channel", native_enum=True), nullable=False
    )
    direction: Mapped[InteractionDirection] = mapped_column(
        Enum(InteractionDirection, name="interaction_direction", native_enum=True), nullable=False
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    business_lead = relationship("BusinessLead", back_populates="interactions")


class FollowUpPlan(Base):
    __tablename__ = "follow_up_plan"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("business_lead.id", ondelete="CASCADE"), nullable=False
    )
    note_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("business_note.id", ondelete="SET NULL"), nullable=True
    )
    recommended_action: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_channel: Mapped[str | None] = mapped_column(String(64))
    reasoning: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="pending")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    business_lead = relationship("BusinessLead", back_populates="follow_up_plans")
    note = relationship("BusinessNote")


class PipelineEvent(Base):
    __tablename__ = "pipeline_event"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("business_lead.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[PipelineEventType] = mapped_column(
        Enum(PipelineEventType, name="pipeline_event_type", native_enum=True), nullable=False
    )
    from_stage: Mapped[PipelineStage | None] = mapped_column(
        Enum(PipelineStage, name="pipeline_stage", native_enum=True), nullable=True
    )
    to_stage: Mapped[PipelineStage | None] = mapped_column(
        Enum(PipelineStage, name="pipeline_stage", native_enum=True), nullable=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    business_lead = relationship("BusinessLead", back_populates="pipeline_events")

