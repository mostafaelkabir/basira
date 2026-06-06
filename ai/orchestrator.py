from langgraph.graph import StateGraph, END
from typing import TypedDict
import subprocess

class State(TypedDict):
    task: dict
    spec: str
    critique: str
    status: str



def run_codex(prompt):
    result = subprocess.run(
        ["codex", prompt],
        text=True,
        capture_output=True
    )
    print(result.stdout)  # for visibility
    return result.stdout


# -------- Agents --------

def architect(state):
    spec = f"""
Design how to implement:

{state['task']['description']}

Constraints:
{state['task']['constraints']}
"""
    return {"spec": spec}


def critic(state):
    critique = f"""
Find flaws in this design:

{state['spec']}

Focus on:
- data integrity
- proof enforcement
"""
    return {"critique": critique}


def builder(state):
    code = run_codex(f"""
Implement this:

{state['spec']}

Fix issues:
{state['critique']}
""")

    return {
        "generated_code": code,
        "status": "generated"
    }


def qa(state):
    print("\n=== QA CHECK ===")
    print("Spec:", state["spec"])
    print("Critique:", state["critique"])
    return {"status": "done"}

# -------- Graph --------

graph = StateGraph(State)

graph.add_node("architect", architect)
graph.add_node("critic", critic)
graph.add_node("builder", builder)
graph.add_node("qa", qa)

graph.set_entry_point("architect")

graph.add_edge("architect", "critic")
graph.add_edge("critic", "builder")
graph.add_edge("builder", "qa")
graph.add_edge("qa", END)

app = graph.compile()


if __name__ == "__main__":
    app.invoke({
        "task": {
            "name": "Add execution logs",
            "description": "Track time_spent and focus_score for tasks",
            "constraints": ["must link to task_id"]
        },
        "spec": "",
        "critique": "",
        "status": ""
    })
    