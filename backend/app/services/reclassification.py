from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import logging
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.models.business import PipelineStage
from app.services.llm.client import LLMResponseError, generate_structured


logger = logging.getLogger(__name__)


class ReclassificationState(TypedDict, total=False):
    current_stage: str
    new_note: str
    prior_notes: list[str]
    candidate: dict[str, Any]
    new_stage: str
    reasoning: str
    error: str


_ALLOWED_STAGES = {stage.value for stage in PipelineStage}


def _build_system_prompt() -> str:
    return (
        "You are a lead reclassification agent for a sales pipeline.\n"
        "Decide whether a new note should change the lead's pipeline stage.\n"
        "Stage meanings:\n"
        "- new: no meaningful engagement yet.\n"
        "- qualified: a good-fit lead with some buying potential, but not yet committed.\n"
        "- warm: real interest is present, but the lead is not ready to buy or move forward yet.\n"
        "- follow_up_later: the lead asked to reconnect later or timing is the only blocker.\n"
        "- sealed_won: the lead has committed to move forward or buy.\n"
        "- lost: the lead explicitly declined, went unreachable after reasonable attempts, or is no longer viable.\n"
        "- not_interested: the lead clearly stated they do not want to continue.\n"
        "Return only valid JSON with new_stage and reasoning. If no change is justified, "
        "return the current stage exactly."
    )


def _schema() -> dict[str, Any]:
    return {
        "new_stage": "string",
        "reasoning": "string",
    }


def _build_graph(client_call):
    graph = StateGraph(ReclassificationState)

    def invoke_claude(state: ReclassificationState) -> ReclassificationState:
        result = client_call(
            system_prompt=_build_system_prompt(),
            user_prompt=(
                f"Current stage: {state['current_stage']}\n"
                f"New note: {state['new_note']}\n"
                "Prior notes:\n"
                + "\n".join(f"- {note}" for note in state.get("prior_notes", []) if note.strip())
                + "\n"
                "Decide the new_stage and explain why."
            ),
            response_schema=_schema(),
        )
        return {"candidate": result}

    def normalize_result(state: ReclassificationState) -> ReclassificationState:
        current_stage = state["current_stage"]
        candidate = state.get("candidate") or {}
        requested_stage = str(candidate.get("new_stage") or current_stage).strip()
        reasoning = str(candidate.get("reasoning") or "").strip()

        if requested_stage not in _ALLOWED_STAGES:
            logger.warning(
                "Reclassification agent returned invalid stage '%s'; keeping '%s'.",
                requested_stage,
                current_stage,
            )
            fallback_reasoning = reasoning or "The AI returned an invalid stage, so the stage was left unchanged."
            return {
                "new_stage": current_stage,
                "reasoning": f"{fallback_reasoning} Invalid stage ignored: {requested_stage}.",
            }

        if requested_stage == current_stage and not reasoning:
            reasoning = "The AI kept the current stage unchanged."

        return {"new_stage": requested_stage, "reasoning": reasoning}

    graph.add_node("invoke_claude", invoke_claude)
    graph.add_node("normalize_result", normalize_result)
    graph.set_entry_point("invoke_claude")
    graph.add_edge("invoke_claude", "normalize_result")
    graph.add_edge("normalize_result", END)
    return graph.compile()


def reclassify_note(
    *,
    current_stage: PipelineStage,
    new_note: str,
    prior_notes: list[str],
    timeout_seconds: int = 10,
    client_call=generate_structured,
) -> dict[str, Any]:
    graph = _build_graph(client_call)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            graph.invoke,
            {
                "current_stage": current_stage.value,
                "new_note": new_note,
                "prior_notes": prior_notes,
            },
        )
        try:
            result = future.result(timeout=timeout_seconds)
        except FuturesTimeoutError:
            logger.warning("Reclassification agent timed out after %s seconds.", timeout_seconds)
            return {
                "new_stage": current_stage.value,
                "reasoning": f"Reclassification timed out after {timeout_seconds} seconds; stage left unchanged.",
            }
        except (LLMResponseError, ValueError) as exc:
            logger.warning("Reclassification agent failed: %s", exc)
            return {
                "new_stage": current_stage.value,
                "reasoning": f"Reclassification failed and the stage was left unchanged: {exc}",
            }
        except Exception as exc:
            logger.exception("Unexpected reclassification failure")
            return {
                "new_stage": current_stage.value,
                "reasoning": f"Reclassification failed and the stage was left unchanged: {exc.__class__.__name__}",
            }

    new_stage = str(result.get("new_stage") or current_stage.value).strip()
    reasoning = str(result.get("reasoning") or "").strip()
    if not reasoning:
        reasoning = "The AI kept the current stage unchanged."
    return {"new_stage": new_stage, "reasoning": reasoning}
