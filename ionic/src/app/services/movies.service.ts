import { Injectable, inject } from '@angular/core'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { environment } from '../../environments/environment'
import type { MatchProfile, Movie, UserProfile } from '../models/movie.model'
import { FirebaseService } from './firebase.service'

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const GENRES: Record<number, string> = {
  12: 'Aventure', 14: 'Fantastique', 16: 'Animation', 18: 'Drame',
  27: 'Horreur', 28: 'Action', 35: 'Comédie', 36: 'Histoire',
  37: 'Western', 53: 'Thriller', 80: 'Crime', 99: 'Documentaire',
  878: 'Science-fiction', 9648: 'Mystère', 10402: 'Musique',
  10749: 'Romance', 10751: 'Familial', 10752: 'Guerre', 10770: 'Téléfilm',
}

function normalizeMovie(id: string, data: Record<string, unknown>): Movie {
  const stringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  const numberArray = (value: unknown): number[] =>
    Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : []
  const genreIds = numberArray(data['genreIds'])
  const storedGenres = stringArray(data['genres'])
  return {
    id,
    ...(typeof data['tmdbId'] === 'number' ? { tmdbId: data['tmdbId'] } : {}),
    title: typeof data['title'] === 'string' ? data['title'] : 'Film sans titre',
    year: typeof data['year'] === 'number' ? data['year'] : null,
    overview: typeof data['overview'] === 'string' ? data['overview'] : '',
    posterPath: typeof data['posterPath'] === 'string' ? data['posterPath'] : null,
    genreIds,
    genres: storedGenres.length
      ? storedGenres
      : genreIds.map((genreId) => GENRES[genreId]).filter((genre): genre is string => Boolean(genre)),
    actorIds: numberArray(data['actorIds']),
    actors: stringArray(data['actors']),
  }
}

@Injectable({ providedIn: 'root' })
export class MoviesService {
  private readonly firebase = inject(FirebaseService)

  async fetchCatalog(): Promise<Movie[]> {
    const snapshot = await getDocs(collection(this.firebase.requireDb(), 'movies'))
    return snapshot.docs
      .map((item) => normalizeMovie(item.id, item.data()))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  }

  async fetchFavorites(uid: string): Promise<Movie[]> {
    const snapshot = await getDocs(collection(this.firebase.requireDb(), 'users', uid, 'favorites'))
    return snapshot.docs.map((item) => normalizeMovie(item.id, item.data()))
  }

  async fetchMatches(uid: string): Promise<MatchProfile[]> {
    const snapshot = await getDocs(query(collection(this.firebase.requireDb(), 'matchProfiles'), where('enabled', '==', true)))
    return snapshot.docs
      .filter((item) => item.id !== uid)
      .map((item) => {
        const data = item.data()
        const favoriteMovies = Array.isArray(data['favoriteMovies'])
          ? data['favoriteMovies'].map((movie: Record<string, unknown>) => normalizeMovie(
            typeof movie['id'] === 'string' ? movie['id'] : '',
            movie,
          ))
          : []
        return {
          uid: item.id,
          displayName: typeof data['displayName'] === 'string' ? data['displayName'] : 'Cinéphile',
          photoURL: typeof data['photoURL'] === 'string' ? data['photoURL'] : '',
          enabled: true,
          favoriteMovies,
        } satisfies MatchProfile
      })
  }

  async syncMatchProfile(profile: UserProfile, favoriteMovies: Movie[]): Promise<void> {
    const profileRef = doc(this.firebase.requireDb(), 'matchProfiles', profile.uid)
    const data = {
      displayName: `${profile.firstName} ${profile.lastName}`,
      photoURL: profile.photoURL,
      favoriteMovies,
      updatedAt: serverTimestamp(),
    }
    if ((await getDoc(profileRef)).exists()) {
      await setDoc(profileRef, data, { merge: true })
    } else {
      await setDoc(profileRef, { ...data, uid: profile.uid, enabled: true })
    }
  }

  async setFavorite(profile: UserProfile, movie: Movie, isFavorite: boolean): Promise<Movie[]> {
    const db = this.firebase.requireDb()
    const favoriteRef = doc(db, 'users', profile.uid, 'favorites', movie.id)
    if (isFavorite) {
      await deleteDoc(favoriteRef)
    } else {
      await setDoc(favoriteRef, {
        ...movie,
        genres: movie.genres ?? [],
        genreIds: movie.genreIds ?? [],
        actors: movie.actors ?? [],
        actorIds: movie.actorIds ?? [],
      })
    }
    const favorites = await this.fetchFavorites(profile.uid)
    await this.syncMatchProfile(profile, favorites)
    return favorites
  }

  async searchMovies(search: string): Promise<Movie[] | null> {
    if (!environment.tmdbApiKey) return null
    const result = await this.tmdbFetch<{ results: Array<{
      id: number
      title: string
      release_date?: string
      overview?: string
      poster_path?: string | null
      genre_ids?: number[]
    }> }>(`/search/movie?query=${encodeURIComponent(search)}`)
    return result.results.map((movie) => ({
      id: `tmdb-${movie.id}`,
      tmdbId: movie.id,
      title: movie.title,
      year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
      overview: movie.overview ?? '',
      posterPath: movie.poster_path ?? null,
      genreIds: movie.genre_ids ?? [],
      genres: (movie.genre_ids ?? []).map((id) => GENRES[id]).filter(Boolean),
      actorIds: [],
      actors: [],
    }))
  }

  async fetchDetails(movie: Movie): Promise<Movie> {
    if (!movie.tmdbId) return movie
    const details = await this.tmdbFetch<{
      credits?: { cast?: Array<{ id: number; name: string }> }
      genres?: Array<{ id: number; name: string }>
    }>(`/movie/${movie.tmdbId}?append_to_response=credits`)
    return {
      ...movie,
      genres: details.genres?.map((genre) => genre.name) ?? movie.genres,
      genreIds: details.genres?.map((genre) => genre.id) ?? movie.genreIds,
      actorIds: details.credits?.cast?.slice(0, 12).map((actor) => actor.id) ?? [],
      actors: details.credits?.cast?.slice(0, 12).map((actor) => actor.name) ?? [],
    }
  }

  async addMovie(uid: string, movie: Omit<Movie, 'id'>): Promise<void> {
    if (this.firebase.auth?.currentUser?.uid !== uid) throw new Error('Votre session ne permet pas cette action.')
    await addDoc(collection(this.firebase.requireDb(), 'movies'), {
      ...movie,
      createdBy: uid,
      createdAt: serverTimestamp(),
    })
  }

  private async tmdbFetch<T>(path: string): Promise<T> {
    if (!environment.tmdbApiKey) throw new Error('Ajoutez la clé TMDB dans src/environments/environment.ts.')
    const separator = path.includes('?') ? '&' : '?'
    const response = await fetch(
      `${TMDB_BASE_URL}${path}${separator}api_key=${encodeURIComponent(environment.tmdbApiKey)}&language=fr-FR`,
    )
    if (!response.ok) throw new Error(`TMDB a répondu avec le statut ${response.status}.`)
    return response.json() as Promise<T>
  }
}
