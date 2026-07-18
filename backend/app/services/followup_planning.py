from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import logging
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.models.business import PipelineStage
from app.services.llm.client import LLMResponseError, generate_structured


logger = logging.getLogger(__name__)


class FollowUpState(TypedDict, total=False):
    current_stage: str
    business_name: str
    note_content: str
    candidate: dict[str, Any]
    recommended_action: str
    suggested_channel: str
    reasoning: str


def _build_system_prompt() -> str:
    return (
        "You are a sales follow-up planning agent.\n"
        "Generate a concrete next action for the salesperson based on the note and lead context.\n"
        "Pipeline stages mean:\n"
        "- new: no meaningful engagement yet.\n"
        "- qualified: a good-fit lead with some buying potential, but not yet committed.\n"
        "- warm: real interest is present, but the lead is not ready to buy or move forward yet.\n"
        "- follow_up_later: the lead asked to reconnect later or timing is the only blocker.\n"
        "- sealed_won: the lead has committed to move forward or buy.\n"
        "- lost: the lead explicitly declined, went unreachable after reasonable attempts, or is no longer viable.\n"
        "- not_interested: the lead clearly stated they do not want to continue.\n"
        "Return only valid JSON with recommended_action, suggested_channel, and reasoning."
    )


def _schema() -> dict[str, Any]:
    return {
        "recommended_action": "string",
        "suggested_channel": "string",
        "reasoning": "string",
    }


def _build_graph(client_call):
    graph = StateGraph(FollowUpState)

    def invoke_claude(state: FollowUpState) -> FollowUpState:
        result = client_call(
            system_prompt=_build_system_prompt(),
            user_prompt=(
                f"Business name: {state['business_name']}\n"
                f"Current stage: {state['current_stage']}\n"
                f"Note content: {state['note_content']}\n"
                "Recommend the single best next action and a channel."
            ),
            response_schema=_schema(),
        )
        return {"candidate": result}

    def normalize_result(state: FollowUpState) -> FollowUpState:
        candidate = state.get("candidate") or {}
        recommended_action = str(candidate.get("recommended_action") or "").strip()
        suggested_channel = str(candidate.get("suggested_channel") or "").strip()
        reasoning = str(candidate.get("reasoning") or "").strip()

        if not recommended_action:
            raise LLMResponseError("Follow-up planner returned an empty recommended_action.")
        if not suggested_channel:
            raise LLMResponseError("Follow-up planner returned an empty suggested_channel.")
        if not reasoning:
            reasoning = "The AI recommended a follow-up action."

        return {
            "recommended_action": recommended_action,
            "suggested_channel": suggested_channel,
            "reasoning": reasoning,
        }

    graph.add_node("invoke_claude", invoke_claude)
    graph.add_node("normalize_result", normalize_result)
    graph.set_entry_point("invoke_claude")
    graph.add_edge("invoke_claude", "normalize_result")
    graph.add_edge("normalize_result", END)
    return graph.compile()


def plan_follow_up(
    *,
    business_name: str,
    current_stage: PipelineStage,
    note_content: str,
    timeout_seconds: int = 10,
    client_call=generate_structured,
) -> dict[str, Any] | None:
    graph = _build_graph(client_call)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            graph.invoke,
            {
                "business_name": business_name,
                "current_stage": current_stage.value,
                "note_content": note_content,
            },
        )
        try:
            result = future.result(timeout=timeout_seconds)
        except FuturesTimeoutError:
            logger.warning("Follow-up planner timed out after %s seconds.", timeout_seconds)
            return None
        except Exception as exc:
            logger.warning("Follow-up planner failed: %s", exc)
            return None

    recommended_action = str(result.get("recommended_action") or "").strip()
    suggested_channel = str(result.get("suggested_channel") or "").strip()
    reasoning = str(result.get("reasoning") or "").strip()
    if not recommended_action or not suggested_channel:
        return None
    if not reasoning:
        reasoning = "The AI recommended a follow-up action."
    return {
        "recommended_action": recommended_action,
        "suggested_channel": suggested_channel,
        "reasoning": reasoning,
    }
