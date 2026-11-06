import { describe, expect, it } from 'vitest'
import { MatchingService } from './matching.service'
import type { Movie } from '../models/movie.model'

const favorite: Movie = {
  id: 'tmdb-1',
  tmdbId: 1,
  title: 'Film partagé',
  year: 2020,
  overview: '',
  posterPath: null,
  genreIds: [18],
  genres: ['Drame'],
  actorIds: [5],
  actors: ['Acteur'],
}

describe('MatchingService', () => {
  const service = new MatchingService()

  it('scores matching movie, genre, actor and year preferences at 100%', () => {
    expect(service.calculate([favorite], [{ ...favorite }])).toMatchObject({
      score: 100,
      movieOverlap: 100,
      genreOverlap: 100,
      actorOverlap: 100,
      yearOverlap: 100,
      sharedTitles: ['Film partagé'],
      sharedGenres: ['Drame'],
      sharedActors: ['Acteur'],
      sharedYears: ['2020'],
    })
  })

  it('returns all shared preference details, including nearby years', () => {
    const otherFavorite = {
      ...favorite,
      id: 'another-film',
      tmdbId: 2,
      title: 'Autre film',
      year: 2022,
    }

    expect(service.calculate([favorite], [otherFavorite])).toMatchObject({
      sharedTitles: [],
      sharedGenres: ['Drame'],
      sharedActors: ['Acteur'],
      sharedYears: ['2020 / 2022'],
    })
  })

  it('finds users above 75% when most favorite preferences match', () => {
    const ownFavorites = [
      favorite,
      { ...favorite, id: 'tmdb-2', tmdbId: 2, title: 'Deuxième film', year: 2021 },
    ]
    const otherFavorites = [
      { ...favorite },
      { ...favorite, id: 'tmdb-3', tmdbId: 3, title: 'Troisième film', year: 2022 },
    ]

    expect(service.calculate(ownFavorites, otherFavorites).score).toBeGreaterThan(75)
  })

  it('can match similar preferences even when users have no identical favorite movie', () => {
    const ownFavorite = { ...favorite, id: 'movie-a', tmdbId: undefined, title: 'Film A' }
    const otherFavorite = { ...favorite, id: 'movie-b', tmdbId: undefined, title: 'Film B' }

    expect(service.calculate([ownFavorite], [otherFavorite]).score).toBeGreaterThan(75)
  })

  it('recognizes the same catalog movie saved with different document IDs', () => {
    const ownFavorite = { ...favorite, id: 'catalog-copy-a', tmdbId: undefined }
    const otherFavorite = { ...favorite, id: 'catalog-copy-b', tmdbId: undefined }

    expect(service.calculate([ownFavorite], [otherFavorite])).toMatchObject({
      score: 100,
      sharedTitles: ['Film partagé'],
    })
  })

  it('recognizes a shared movie when one favorite has a TMDB ID and the other does not', () => {
    const favoriteWithoutTmdbId = { ...favorite, tmdbId: undefined }

    expect(service.calculate([favorite], [favoriteWithoutTmdbId])).toMatchObject({
      score: 100,
      sharedTitles: ['Film partagé'],
    })
  })

  it('does not penalize missing genre or actor metadata for a shared favorite', () => {
    const movieWithoutMetadata = { ...favorite, genres: [], actors: [], actorIds: [], genreIds: [] }
    const result = service.calculate([movieWithoutMetadata], [{ ...movieWithoutMetadata }])

    expect(result.score).toBeGreaterThan(75)
    expect(result.sharedTitles).toEqual(['Film partagé'])
  })

  it('does not report a match above 75% for unrelated preferences', () => {
    const unrelated = { ...favorite, id: 'tmdb-2', tmdbId: 2, year: 1990, genres: ['Comédie'], genreIds: [35], actors: ['Autre'], actorIds: [99] }
    expect(service.calculate([favorite], [unrelated]).score).toBeLessThanOrEqual(75)
  })
})
