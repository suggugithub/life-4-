

import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { AIClassificationResponse, AIBreakdownResponse, AICoachingResponse, AIMoodSuggestionResponse, Task, StudentContext, QuadrantType } from '../types';
import { GEMINI_MODEL_NAME, QUADRANT_CONFIGS } from '../constants';

const parseJsonFromText = <T,>(text: string): T => {
  let jsonStr = text.trim();
  const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
  const match = jsonStr.match(fenceRegex);
  if (match && match[2]) {
    jsonStr = match[2].trim();
  }
  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    console.error("Failed to parse JSON response from AI:", e, "Original text:", text);
    throw new Error(`AI returned an invalid JSON format. Response: ${text.slice(0,100)}...`);
  }
};

const getEffectiveApiKey = (userApiKey?: string): string => {
  if (!userApiKey) {
    throw new Error("Gemini API key is not configured. Please add your API key in Settings.");
  }
  return userApiKey;
}

export const performAIClassification = async (
  task: Task, 
  studentContext: StudentContext,
  allTasks: Task[],
  isRecurringInstance: boolean,
  userApiKey?: string
): Promise<AIClassificationResponse> => {
  const effectiveApiKey = getEffectiveApiKey(userApiKey);
  const ai = new GoogleGenAI({ apiKey: effectiveApiKey });

  const systemInstruction = `You are an expert assistant specializing in student productivity using the Eisenhower Matrix. Today's Date: ${new Date().toLocaleDateString('en-CA')}.
1. Classify tasks into 'do', 'schedule', 'delegate', or 'delete'. These are the only valid strings for the "quadrant" field.
2. If classifying into 'do' or 'schedule', ALSO suggest a realistic due date (in 'YYYY-MM-DD' format) and provide a brief "dateReasoning".
3. If the task is a new recurring task instance, check the user's schedule (provided in context) and add a 'schedulingHint' if the new due date looks busy.
4. Respond ONLY with a valid JSON object with: "quadrant" (string: "do", "schedule", "delegate", or "delete"), "reasoning" (string, max 20 words), "suggestedDate" (string, 'YYYY-MM-DD', optional), "dateReasoning" (string, optional), and "schedulingHint" (string, optional). Ensure the quadrant value is one of the four specified.`;

  const userPrompt = `Context:\n- Exams: ${studentContext.exams.text||'N/A'} (Due: ${studentContext.exams.date||'N/A'})\n- Assignments: ${studentContext.assignments.text||'N/A'} (Due: ${studentContext.assignments.date||'N/A'})\n- Goals: ${studentContext.goals||'N/A'}\n- Mood: ${studentContext.mood||'N/A'}\n- Other: ${studentContext.openContext||'N/A'}\n- Current 'Do' and 'Schedule' tasks: ${allTasks.filter(t => (t.quadrant === 'do' || t.quadrant === 'schedule') && !t.parentId).map(t => `${t.name} (Due: ${t.dueDate})`).join(', ') || 'None'}\n\nTask: "${task.name}" (Current Due: ${task.dueDate || 'N/A'})${isRecurringInstance ? ' - This is a newly generated recurring task instance.' : ''}`;
  
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: GEMINI_MODEL_NAME,
        contents: userPrompt,
        config: {
            systemInstruction: systemInstruction,
            responseMimeType: "application/json",
        }
    });
    
    const classificationResult = parseJsonFromText<AIClassificationResponse>(response.text);
    if (QUADRANT_CONFIGS[classificationResult.quadrant as QuadrantType]) {
      return classificationResult;
    }
    console.warn("AI returned an invalid quadrant string:", classificationResult.quadrant);
    throw new Error(`AI returned an invalid quadrant: "${classificationResult.quadrant}". Valid quadrants are "do", "schedule", "delegate", "delete".`);

  } catch (error: any) {
    console.error("Error in performAIClassification:", error);
    throw new Error(`AI Classification failed: ${error.message}`);
  }
};

export const performAIBreakdown = async (taskName: string, userApiKey?: string): Promise<AIBreakdownResponse> => {
  const effectiveApiKey = getEffectiveApiKey(userApiKey);
  const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
  
  const prompt = `Break down the following complex task into a list of smaller, actionable sub-tasks. Task: "${taskName}". Respond ONLY with a valid JSON object like: {"subtasks": ["subtask 1", "subtask 2", "subtask 3"]}. Keep subtasks concise.`;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: GEMINI_MODEL_NAME,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
        }
    });
    return parseJsonFromText<AIBreakdownResponse>(response.text);
  } catch (error: any) {
    console.error("Error in performAIBreakdown:", error);
    throw new Error(`AI Breakdown failed: ${error.message}`);
  }
};

export const getAIMoveReasoning = async (taskName: string, oldQuadrantName: string, newQuadrantName: string, userApiKey?: string): Promise<AICoachingResponse> => {
  const effectiveApiKey = getEffectiveApiKey(userApiKey);
  const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
  
  const prompt = `A user moved a task "${taskName}" from the "${oldQuadrantName}" quadrant to the "${newQuadrantName}" quadrant. Provide a brief, one-sentence coaching insight or reflective question about this move (max 25 words). Respond ONLY with a valid JSON object: {"insight": "Your insightful comment here."}`;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: GEMINI_MODEL_NAME,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
        }
    });
    return parseJsonFromText<AICoachingResponse>(response.text);
  } catch (error: any) {
    console.error("Error in getAIMoveReasoning:", error);
    // Don't throw for coaching, just log it, as it's non-critical.
    return { insight: "" }; // Return empty insight on failure
  }
};


export const getAIMoodSuggestion = async (
  mood: string,
  tasks: Task[],
  userApiKey?: string
): Promise<AIMoodSuggestionResponse> => {
  const effectiveApiKey = getEffectiveApiKey(userApiKey);
  const ai = new GoogleGenAI({ apiKey: effectiveApiKey });

  const doNowTasks = tasks
    .filter(t => t.status === 'active' && t.quadrant === 'do' && !t.parentId)
    .map(t => t.name)
    .join(', ');

  const prompt = `A user is feeling "${mood}". Their current high-priority tasks are: ${doNowTasks || 'None'}. Provide one short, actionable, and encouraging suggestion (max 30 words) to help them get started or manage their day. Frame it as a friendly tip. Respond ONLY with a valid JSON object: {"suggestion": "Your suggestion here."}`;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });
    return parseJsonFromText<AIMoodSuggestionResponse>(response.text);
  } catch (error: any) {
    console.error("Error in getAIMoodSuggestion:", error);
    throw new Error(`AI Mood Suggestion failed: ${error.message}`);
  }
};
