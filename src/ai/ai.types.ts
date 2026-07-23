import { Difficulty, QuestionType } from '@prisma/client';

export interface GeneratedQuestion {
  type: QuestionType;
  difficulty: Difficulty;
  prompt: string;
  options?: Array<{ id: string; text: string }>;
  answerKey: unknown;
  explanation: string;
  maxScore: number;
  tags?: string[];
}

export interface GradeResult {
  score: number;
  isCorrect: boolean;
  feedback: string;
  confidence: number;
}

export interface LearningReport {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  group: 'STRONG' | 'AVERAGE' | 'NEEDS_SUPPORT';
}
