"""
app/agents/graph.py
===================
LangGraph StateGraph wiring the 4 equity research agents + Synthesis.

On the **free OpenRouter tier** the parallel agents fire simultaneously and
trip rate limits. To avoid this the agents are wired SEQUENTIALLY here
(A → B → C → D → Synthesis). This has the same logical result — every agent
runs before Synthesis — but sends only one request at a time.

When you upgrade to a paid API key, flip SEQUENTIAL_AGENTS = False to
restore true parallel Send() execution.
"""

from typing import Any, TypedDict

from langgraph.graph import StateGraph, START, END

from app.agents.nodes import (
    run_agent_a_fundamentals,
    run_agent_b_sector,
    run_agent_c_sentiment,
    run_agent_d_valuation,
    run_synthesis,
)

# Set to False when using a paid API key to enable true parallel execution
SEQUENTIAL_AGENTS = True


class AgentState(TypedDict):
    ticker: str
    sector: str
    technical_score: float

    # Outputs from the 4 specialist agents
    agent_a_output: dict[str, Any]
    agent_b_output: dict[str, Any]
    agent_c_output: dict[str, Any]
    agent_d_output: dict[str, Any]

    # Final synthesis output
    synthesis_output: dict[str, Any]


def build_graph() -> StateGraph:
    builder = StateGraph(AgentState)

    # Always add all nodes
    builder.add_node("agent_a", run_agent_a_fundamentals)
    builder.add_node("agent_b", run_agent_b_sector)
    builder.add_node("agent_c", run_agent_c_sentiment)
    builder.add_node("agent_d", run_agent_d_valuation)
    builder.add_node("synthesis", run_synthesis)

    if SEQUENTIAL_AGENTS:
        # Sequential chain: START → A → B → C → D → Synthesis → END
        builder.add_edge(START, "agent_a")
        builder.add_edge("agent_a", "agent_b")
        builder.add_edge("agent_b", "agent_c")
        builder.add_edge("agent_c", "agent_d")
        builder.add_edge("agent_d", "synthesis")
    else:
        # True parallel execution (needs paid API tier)
        builder.add_edge(START, "agent_a")
        builder.add_edge(START, "agent_b")
        builder.add_edge(START, "agent_c")
        builder.add_edge(START, "agent_d")
        builder.add_edge("agent_a", "synthesis")
        builder.add_edge("agent_b", "synthesis")
        builder.add_edge("agent_c", "synthesis")
        builder.add_edge("agent_d", "synthesis")

    builder.add_edge("synthesis", END)
    return builder.compile()


graph = build_graph()
