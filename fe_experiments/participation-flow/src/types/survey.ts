export interface SurveyQuestion {
  id: string;
  text: string;
  hint?: string;
}

export interface Survey {
  id: string;
  title: string;
  description: string;
  ctaLabel: string;
  questions: SurveyQuestion[];
  accentColor?: string;
}

export interface VoiceAnswer {
  questionId: string;
  blob: Blob;
  url: string;
  durationMs: number;
}
