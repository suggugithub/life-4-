

export interface Task {
  id: string;
  name: string;
  dueDate: string; // YYYY-MM-DD
  quadrant: QuadrantType;
  reasoning: string;
  dateReasoning?: string;
  schedulingHint?: string;
  createdAt: string; // ISO string
  status: 'active' | 'completed' | 'trashed';
  recurring: RecurringSettings | null;
  parentId: string | null; // For sub-tasks
}

export type QuadrantType = 'do' | 'schedule' | 'delegate' | 'delete' | 'unclassified';

export interface Quadrant {
  name: string;
  bg: string;
  text: string;
  border: string;
  iconColor: string;
}

export interface StudentContext {
  exams: { text: string; date: string };
  assignments: { text: string; date: string };
  goals: string;
  mood: string;
  openContext: string;
}

export interface AppSettings {
  enableCoaching: boolean;
  apiKey: string; // User's personal Gemini API key
}

export interface RecurringSettings {
  type: 'daily' | 'weekly' | 'monthly' | 'none';
  interval: number;
}

export interface ModalState<T> {
  isOpen: boolean;
  data: T | null;
}

export interface SubtaskModalData {
    task: Task;
    subtasks: string[];
    isLoading: boolean;
}

export interface ToastData {
  show: boolean;
  message: string;
  type: 'success' | 'info' | 'error' | 'coach';
}

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
}

// For react-dnd
export const ItemTypes = {
  TASK: 'task',
};

export interface DraggableTaskItem {
  id: string;
  quadrant: QuadrantType;
  parentId: string | null;
}

export interface AIClassificationResponse {
  quadrant: QuadrantType;
  reasoning: string;
  suggestedDate?: string;
  dateReasoning?: string;
  schedulingHint?: string;
}

export interface AIBreakdownResponse {
  subtasks: string[];
}

export interface AICoachingResponse {
  insight: string;
}

export interface AIMoodSuggestionResponse {
    suggestion: string;
}
