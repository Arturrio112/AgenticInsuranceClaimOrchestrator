import { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";
import type { ClaimDecision } from "./decision";
import type { ClaimStatus } from "../db/schema";

/** The claim as loaded from Postgres before the agent starts reasoning. */
export interface ClaimContext {
    id: number;
    policy_id: number;
    policy_number: string | null;
    claim_amount: number;
    damage_type: string;
    status: ClaimStatus;
    description: string | null;
}

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
    /** Loaded by the `load_claim` node; `null` when the claim does not exist. */
    claim: Annotation<ClaimContext | null>({
        reducer: (state, update) => (update === undefined ? state : update),
        default: () => null,
    }),
    /** Structured decision produced by the `decide` node. */
    decision: Annotation<ClaimDecision | null>({
        reducer: (state, update) => (update === undefined ? state : update),
        default: () => null,
    }),
    /** Final status written to the DB by the `persist` node. */
    claim_status: Annotation<ClaimStatus>({
        reducer: (state, update) => update ?? state,
    }),
});

export type GraphStateType = typeof GraphState.State;
