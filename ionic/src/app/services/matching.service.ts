import { Injectable } from '@angular/core'
import type { MatchResult, Movie } from '../models/movie.model'

function diceCoefficient(left: Set<string>, right: Set<string>): number {
  if (!left.size && !right.size) return 0
  let shared = 0
  for (const value of left) if (right.has(value)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

function yearSimilarity(left: Movie[], right: Movie[]): number {
  const pairs = matchingYears(left, right)
  const leftYears = left.map((movie) => movie.year).filter((year): year is number => year !== null)
  const rightYears = right.map((movie) => movie.year).filter((year): year is number => year !== null)
  if (!leftYears.length || !rightYears.length) return 0
  return (2 * pairs.length) / (leftYears.length + rightYears.length)
}

function matchingYears(left: Movie[], right: Movie[]): Array<{ left: number; right: number }> {
  const used = new Set<number>()
  const pairs: Array<{ left: number; right: number }> = []
  for (const movie of left) {
    const year = movie.year
    if (year === null) continue
    const index = right.findIndex((candidate, candidateIndex) =>
      !used.has(candidateIndex) && candidate.year !== null && Math.abs(candidate.year - year) <= 2,
    )
    if (index >= 0) {
      used.add(index)
      const matchedYear = right[index].year
      if (matchedYear !== null) pairs.push({ left: year, right: matchedYear })
    }
  }
  return pairs
}

function normalized(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))
}

function sharedValues(left: string[], right: string[]): string[] {
  const rightValues = normalized(right)
  return [...new Map(
    left
      .filter((value) => rightValues.has(value.trim().toLocaleLowerCase()))
      .map((value) => [value.trim().toLocaleLowerCase(), value.trim()]),
  ).values()]
}

function normalizedTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase()
}

function sameMovie(left: Movie, right: Movie): boolean {
  if (left.tmdbId && right.tmdbId && left.tmdbId === right.tmdbId) return true
  const leftTitle = normalizedTitle(left.title)
  const rightTitle = normalizedTitle(right.title)
  if (!leftTitle || leftTitle !== rightTitle) return false
  return left.year === null || right.year === null || left.year === right.year
}

function sharedMovies(own: Movie[], other: Movie[]): Movie[] {
  const usedOtherMovies = new Set<number>()
  return own.filter((movie) => {
    const index = other.findIndex((candidate, candidateIndex) =>
      !usedOtherMovies.has(candidateIndex) && sameMovie(movie, candidate),
    )
    if (index < 0) return false
    usedOtherMovies.add(index)
    return true
  })
}

@Injectable({ providedIn: 'root' })
export class MatchingService {
  calculate(own: Movie[], other: Movie[]): MatchResult {
    const commonMovies = sharedMovies(own, other)
    const movieScore = own.length || other.length
      ? (2 * commonMovies.length) / (own.length + other.length)
      : 0
    const ownGenres = normalized(own.flatMap((movie) => movie.genres ?? []))
    const otherGenres = normalized(other.flatMap((movie) => movie.genres ?? []))
    const ownActors = normalized(own.flatMap((movie) => movie.actorIds?.length ? movie.actorIds.map(String) : movie.actors ?? []))
    const otherActors = normalized(other.flatMap((movie) => movie.actorIds?.length ? movie.actorIds.map(String) : movie.actors ?? []))
    const ownGenreNames = own.flatMap((movie) => movie.genres ?? [])
    const otherGenreNames = other.flatMap((movie) => movie.genres ?? [])
    const ownActorNames = own.flatMap((movie) => movie.actors ?? [])
    const otherActorNames = other.flatMap((movie) => movie.actors ?? [])
    const genreScore = diceCoefficient(ownGenres, otherGenres)
    const actorScore = diceCoefficient(ownActors, otherActors)
    const yearsScore = yearSimilarity(own, other)
    const weightedScores = [
      { score: movieScore, weight: 0.15, available: own.length > 0 && other.length > 0 },
      { score: genreScore, weight: 0.35, available: ownGenres.size > 0 && otherGenres.size > 0 },
      { score: actorScore, weight: 0.3, available: ownActors.size > 0 && otherActors.size > 0 },
      {
        score: yearsScore,
        weight: 0.2,
        available: own.some((movie) => movie.year !== null) && other.some((movie) => movie.year !== null),
      },
    ].filter((item) => item.available)
    const availableWeight = weightedScores.reduce((total, item) => total + item.weight, 0)
    const score = availableWeight
      ? weightedScores.reduce((total, item) => total + item.score * item.weight, 0) / availableWeight
      : 0

    return {
      score: Math.round(score * 100),
      movieOverlap: Math.round(movieScore * 100),
      genreOverlap: Math.round(genreScore * 100),
      actorOverlap: Math.round(actorScore * 100),
      yearOverlap: Math.round(yearsScore * 100),
      sharedTitles: commonMovies.map((movie) => movie.title),
      sharedGenres: sharedValues(ownGenreNames, otherGenreNames),
      sharedActors: sharedValues(ownActorNames, otherActorNames),
      sharedYears: [...new Set(matchingYears(own, other).map(({ left, right }) =>
        left === right ? `${left}` : `${left} / ${right}`,
      ))],
    }
  }
}
