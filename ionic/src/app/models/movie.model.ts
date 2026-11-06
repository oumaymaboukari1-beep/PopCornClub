export interface Movie {
  id: string
  tmdbId?: number
  title: string
  year: number | null
  overview: string
  posterPath: string | null
  genreIds: number[]
  genres: string[]
  actorIds: number[]
  actors: string[]
}

export interface UserProfile {
  uid: string
  email: string
  firstName: string
  lastName: string
  age: number
  photoURL: string
  photos?: string[]
  role: 'admin' | 'user'
  disabled: boolean
}

export interface MatchProfile {
  uid: string
  displayName: string
  photoURL: string
  enabled: boolean
  favoriteMovies: Movie[]
}

export interface MatchResult {
  score: number
  movieOverlap: number
  genreOverlap: number
  actorOverlap: number
  yearOverlap: number
  sharedTitles: string[]
  sharedGenres: string[]
  sharedActors: string[]
  sharedYears: string[]
}
