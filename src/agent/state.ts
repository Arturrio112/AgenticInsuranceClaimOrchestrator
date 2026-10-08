import { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";

export const GraphState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: (state, update) => state.concat(update),
        default: () => [],
    }),
    claim_id: Annotation<number>({
        reducer: (state, update) => update ?? state,
    }),
    policy_number: Annotation<string>({
        reducer: (state, update) => update ?? state,
    }),
    claim_status: Annotation<string>({
        reducer: (state, update) => update ?? state,
    }),
});

export type GraphStateType = typeof GraphState.State;
