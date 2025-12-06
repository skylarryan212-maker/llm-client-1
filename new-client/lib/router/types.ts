export type RouterDecision = {
  topicAction: "continue_active" | "new" | "reopen_existing";
  primaryTopicId: string | null;
  secondaryTopicIds: string[];
  newTopicLabel?: string;
  newTopicDescription?: string;
  newParentTopicId?: string | null;
  newTopicSummary?: string;
  artifactsToLoad: string[];
};
