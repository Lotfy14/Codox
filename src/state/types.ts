export type AppStep = 'setup' | 'upload' | 'progress' | 'review' | 'export'

export interface JobState {
  id: string
  createdAt: number
  step: AppStep
}
