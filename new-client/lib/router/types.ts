export type RouterDecision = {
  topicAction: "continue_active" | "new" | "reopen_existing";
  primaryTopicId: string | null;
  secondaryTopicIds: string[];
  newTopicLabel?: string | null;
  newTopicDescription?: string | null;
  newParentTopicId?: string | null;
  newTopicSummary?: string | null;
  artifactsToLoad: string[];
};
