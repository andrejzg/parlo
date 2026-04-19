/**
 * Typed HTTP client for the Parlo backend API.
 * See CLAUDE.md for full API contract details.
 */

export interface CreateSurveyParams {
  creatorPhone?: string;
  creatorName?: string;
  title?: string;
}

export interface CreateSurveyResponse {
  id: string;
  code: string;
  dashboardCode: string;
  uploadUrls: {
    audience: string;
    gather: string;
  };
}

export interface Question {
  text: string;
  hint?: string;
}

export interface GenerateQuestionsResponse {
  title: string;
  questions: Question[];
}

export interface SavedQuestion {
  id: string;
  survey_id: string;
  sort_order: number;
  text: string;
  hint: string | null;
}

export interface UpdateQuestionsResponse {
  questions: SavedQuestion[];
}

export interface SurveyResponse {
  id: string;
  title: string | null;
  status: string;
  questions: SavedQuestion[];
  audioKeys: { questionKey: string; audioR2Key: string }[];
}

export interface StartResponseResponse {
  id: string;
  code: string;
  uploadUrls: Record<string, string>;
}

export interface DashboardResponse {
  survey: {
    id: string;
    title: string | null;
    code: string;
    dashboardCode: string;
    status: string;
    createdAt: string;
  };
  questions: SavedQuestion[];
  responses: DashboardResponseEntry[];
}

export interface DashboardResponseEntry {
  id: string;
  firstName: string | null;
  lastName: string | null;
  submittedAt: string;
  answers: {
    questionId: string;
    audioUrl: string;
    transcription: string | null;
    transcriptionStatus: string;
  }[];
}

export interface MySurvey {
  id: string;
  code: string;
  dashboardCode: string;
  title: string | null;
  status: string;
  responseCount: number;
  createdAt: string;
}

class ParloApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: string,
  ) {
    super(`Parlo API error ${status} ${statusText}: ${body}`);
    this.name = "ParloApiError";
  }
}

export class ParloClient {
  private backendUrl: string;
  private apiKey?: string;
  private serviceBinding?: Fetcher;

  constructor(backendUrl: string, apiKey?: string, serviceBinding?: Fetcher) {
    this.backendUrl = backendUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.serviceBinding = serviceBinding;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      h["X-Parlo-Api-Key"] = this.apiKey;
    }
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const fetchFn = this.serviceBinding
      ? (url: string, init?: RequestInit) => this.serviceBinding!.fetch(url, init)
      : fetch;

    const res = await fetchFn(`${this.backendUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ParloApiError(res.status, res.statusText, text);
    }

    return res.json() as Promise<T>;
  }

  async createSurvey(params?: CreateSurveyParams): Promise<CreateSurveyResponse> {
    return this.request("POST", "/api/surveys", params ?? {});
  }

  async generateQuestions(
    surveyId: string,
    textAnswers?: { audience?: string; gather?: string },
  ): Promise<GenerateQuestionsResponse> {
    return this.request("POST", `/api/surveys/${surveyId}/generate`, {
      textAnswers,
    });
  }

  async updateQuestions(
    surveyId: string,
    questions: Question[],
  ): Promise<UpdateQuestionsResponse> {
    return this.request("PUT", `/api/surveys/${surveyId}/questions`, {
      questions,
    });
  }

  async getSurvey(code: string): Promise<SurveyResponse> {
    return this.request("GET", `/api/s/${code}`);
  }

  async startResponse(code: string): Promise<StartResponseResponse> {
    return this.request("POST", `/api/s/${code}/responses`);
  }

  async getDashboard(dashboardCode: string): Promise<DashboardResponse> {
    return this.request("GET", `/api/d/${dashboardCode}`);
  }

  async listMySurveys(): Promise<MySurvey[]> {
    if (!this.apiKey) {
      throw new Error("API key is required to list surveys");
    }
    return this.request("GET", "/api/my/surveys");
  }
}
