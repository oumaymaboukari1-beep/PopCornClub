import { Component, computed, CUSTOM_ELEMENTS_SCHEMA, inject, OnDestroy, OnInit, signal } from '@angular/core'
import { FormsModule, NgForm } from '@angular/forms'
import {
  ActionSheetController,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonChip,
  IonCol,
  IonContent,
  IonGrid,
  IonIcon,
  IonInput,
  IonLabel,
  IonRow,
  ToastController,
} from '@ionic/angular'
import { Camera } from '@capacitor/camera'
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { addIcons } from 'ionicons'
import {
  addOutline,
  cameraOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  filmOutline,
  heart,
  heartOutline,
  imagesOutline,
  logOutOutline,
  peopleOutline,
  personCircleOutline,
  searchOutline,
  shieldCheckmarkOutline,
  sparklesOutline,
  trashOutline,
  videocamOutline,
} from 'ionicons/icons'
import type { MatchProfile, Movie, UserProfile } from '../models/movie.model'
import { FirebaseService } from '../services/firebase.service'
import { MatchingService } from '../services/matching.service'
import { MoviesService } from '../services/movies.service'

type Page = 'discover' | 'favorites' | 'matches' | 'admin'
type AuthMode = 'login' | 'register'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}

const MAX_PHOTO_DATA_URL_LENGTH = 150_000
const MAX_PROFILE_PHOTOS = 5

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  imports: [FormsModule, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonChip, IonCol, IonContent, IonGrid, IonIcon, IonInput, IonLabel, IonRow],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class HomePage implements OnInit, OnDestroy {
  private readonly firebase = inject(FirebaseService)
  private readonly moviesService = inject(MoviesService)
  private readonly matchingService = inject(MatchingService)
  private readonly actionSheet = inject(ActionSheetController)
  private readonly toastController = inject(ToastController)
  private authUnsubscribe?: () => void
  private registering = false

  readonly icons = {
    add: addOutline,
    camera: cameraOutline,
    check: checkmarkCircleOutline,
    close: closeCircleOutline,
    film: filmOutline,
    heart,
    heartOutline,
    images: imagesOutline,
    logout: logOutOutline,
    people: peopleOutline,
    person: personCircleOutline,
    search: searchOutline,
    shield: shieldCheckmarkOutline,
    sparkles: sparklesOutline,
    trash: trashOutline,
    video: videocamOutline,
  }
  readonly configured = this.firebase.configured
  readonly page = signal<Page>('discover')
  readonly authMode = signal<AuthMode>('login')
  readonly authUser = signal<User | null>(null)
  readonly profile = signal<UserProfile | null>(null)
  readonly catalog = signal<Movie[]>([])
  readonly favorites = signal<Movie[]>([])
  readonly matchProfiles = signal<MatchProfile[]>([])
  readonly adminUsers = signal<UserProfile[]>([])
  readonly searchText = signal('')
  inputKeyword: string = ''
  tabKeywords: string[] = []
  inputActor: string = ''
  tabActors: string[] = []
  readonly tabPhotos = signal<string[]>([])
  readonly moviePoster = signal<string | null>(null)
  readonly tmdbResults = signal<Movie[] | null>(null)
  readonly loading = signal(true)
  readonly refreshing = signal(false)
  readonly error = signal('')
  readonly notice = signal('')
  readonly isAdmin = computed(() => this.profile()?.role === 'admin')
  readonly favoriteIds = computed(() => new Set(this.favorites().map((movie) => movie.id)))
  readonly hasOtherUsersWithFavorites = computed(() =>
    this.matchProfiles().some((matchProfile) => matchProfile.favoriteMovies.length > 0),
  )
  readonly rankedMatches = computed(() =>
    this.matchProfiles()
      .map((matchProfile) => ({
        profile: matchProfile,
        result: this.matchingService.calculate(this.favorites(), matchProfile.favoriteMovies ?? []),
      }))
      .filter((match) => match.result.score > 75)
      .sort((left, right) => right.result.score - left.result.score),
  )
  readonly developingMatches = computed(() =>
    this.matchProfiles()
      .map((matchProfile) => ({
        profile: matchProfile,
        result: this.matchingService.calculate(this.favorites(), matchProfile.favoriteMovies ?? []),
      }))
      .filter((match) => match.result.score <= 75 && match.result.sharedTitles.length > 0)
      .sort((left, right) => right.result.score - left.result.score),
  )
  readonly shownMovies = computed(() =>
    this.page() === 'favorites'
      ? this.favorites()
      : this.tmdbResults() ?? this.catalog().filter((movie) =>
        movie.title.toLocaleLowerCase().includes(this.searchText().trim().toLocaleLowerCase()),
      ),
  )
  constructor() {
    addIcons(this.icons)
  }

  ngOnInit(): void {
    if (!this.firebase.auth) {
      this.loading.set(false)
      return
    }
    this.authUnsubscribe = onAuthStateChanged(this.firebase.auth, (user) => {
      this.authUser.set(user)
      if (!user) {
        this.profile.set(null)
        this.favorites.set([])
        this.matchProfiles.set([])
        this.loading.set(false)
        return
      }
      if (this.registering) return
      void this.loadProfile(user)
    })
  }

  ngOnDestroy(): void {
    this.authUnsubscribe?.()
  }

  async submitAuth(form: NgForm): Promise<void> {
    const auth = this.firebase.auth
    const db = this.firebase.db
    if (!auth || !db) {
      this.error.set('Firebase n’est pas configuré. ')
      return
    }
    if (form.invalid) {
      form.control.markAllAsTouched()
      return
    }
    this.loading.set(true)
    this.error.set('')
    this.notice.set('')
    try {
      const { email, password, firstName, lastName, age } = form.value as {
        email: string
        password: string
        firstName?: string
        lastName?: string
        age?: number | string
      }
      const normalizedEmail = email.trim().toLocaleLowerCase()
      if (this.authMode() === 'login') {
        await signInWithEmailAndPassword(auth, normalizedEmail, password)
        await this.presentToast('Ravi de vous revoir !', 'success')
        return
      }
      const photos = this.tabPhotos()
      if (!photos.length) throw new Error('Ajoutez au moins une photo pour compléter votre inscription.')
      const parsedAge = Number(age)
      if (parsedAge < 15 || parsedAge > 90) throw new Error('L’âge doit être compris entre 15 et 90 ans.')
      if (photos.length > MAX_PROFILE_PHOTOS) throw new Error(`Vous pouvez ajouter jusqu’à ${MAX_PROFILE_PHOTOS} photos.`)
      if (photos.some((photo) => photo.length > MAX_PHOTO_DATA_URL_LENGTH)) {
        throw new Error('Une photo est trop volumineuse. Reprenez-la pour la compresser.')
      }
      this.registering = true
      const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password)
      let newProfile: UserProfile
      try {
        const photoURL = photos[0]
        newProfile = {
          uid: credential.user.uid,
          email: normalizedEmail,
          firstName: firstName!.trim(),
          lastName: lastName!.trim(),
          age: parsedAge,
          photoURL,
          photos,
          role: 'user',
          disabled: false,
        }
        const batch = writeBatch(db)
        batch.set(doc(db, 'users', credential.user.uid), {
          ...newProfile,
          createdAt: serverTimestamp(),
        })
        batch.set(doc(db, 'matchProfiles', credential.user.uid), {
          uid: credential.user.uid,
          displayName: `${newProfile.firstName} ${newProfile.lastName}`,
          photoURL,
          enabled: true,
          favoriteMovies: [],
          updatedAt: serverTimestamp(),
        })
        await batch.commit()
      } catch (registrationError) {
        try {
          await deleteUser(credential.user)
        } catch (cleanupError) {
          throw new Error(`Inscription interrompue : ${messageOf(registrationError)}. Le compte créé n’a pas pu être nettoyé : ${messageOf(cleanupError)}`)
        }
        throw registrationError
      }
      this.profile.set(newProfile)
      this.tabPhotos.set([])
      await this.presentToast('Votre compte est prêt. Bienvenue dans Popcorn Club !', 'success')
      await this.refreshData()
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : ''
      const message = code === 'auth/email-already-in-use'
        ? 'Cette adresse e-mail est déjà utilisée. Connectez-vous ou choisissez une autre adresse.'
        : messageOf(error)
      await this.presentToast(message, 'danger')
    } finally {
      this.registering = false
      this.loading.set(false)
    }
  }

  async presentPhotoActionSheet(): Promise<void> {
    if (this.tabPhotos().length >= MAX_PROFILE_PHOTOS) {
      await this.presentToast(`Vous pouvez ajouter jusqu’à ${MAX_PROFILE_PHOTOS} photos.`, 'warning')
      return
    }
    const actionSheet = await this.actionSheet.create({
      header: 'Ajouter une photo',
      buttons: [
        {
          text: 'Prendre une photo',
          icon: 'camera-outline',
          handler: () => {
            void this.selectPhoto('camera')
          },
        },
        {
          text: 'Choisir depuis la galerie',
          icon: 'image-outline',
          handler: () => {
            void this.selectPhoto('gallery')
          },
        },
        { text: 'Annuler', role: 'cancel' },
      ],
    })
    await actionSheet.present()
  }

  async presentMoviePosterActionSheet(): Promise<void> {
    const actionSheet = await this.actionSheet.create({
      header: 'Ajouter une affiche',
      buttons: [
        {
          text: 'Prendre une photo',
          icon: 'camera-outline',
          handler: () => {
            void this.selectMoviePoster('camera')
          },
        },
        {
          text: 'Choisir depuis la galerie',
          icon: 'image-outline',
          handler: () => {
            void this.selectMoviePoster('gallery')
          },
        },
        { text: 'Annuler', role: 'cancel' },
      ],
    })
    await actionSheet.present()
  }

  private async selectPhoto(source: 'camera' | 'gallery'): Promise<void> {
    this.error.set('')
    try {
      if (this.inputKeyword.trim()) this.addKeyword()
      const compressedPhotos = await this.capturePhotos(source, MAX_PROFILE_PHOTOS - this.tabPhotos().length)
      this.tabPhotos.update((currentPhotos) => [
        ...currentPhotos,
        ...compressedPhotos.filter((photo) => !currentPhotos.includes(photo)),
      ].slice(0, MAX_PROFILE_PHOTOS))
    } catch (error) {
      this.error.set(messageOf(error))
    }
  }

  private async selectMoviePoster(source: 'camera' | 'gallery'): Promise<void> {
    this.error.set('')
    try {
      const [poster] = await this.capturePhotos(source, 1)
      if (poster) this.moviePoster.set(poster)
    } catch (error) {
      this.error.set(messageOf(error))
    }
  }

  private async capturePhotos(source: 'camera' | 'gallery', limit: number): Promise<string[]> {
    const photos = source === 'camera'
      ? [await Camera.takePhoto({ quality: 70 })]
      : (await Camera.chooseFromGallery({ quality: 70, limit })).results
    return Promise.all(photos.map(async (photo) => {
      if (!photo.thumbnail) throw new Error('La caméra n’a pas renvoyé une image.')
      const format = photo.metadata?.format?.toLowerCase()
      const mimeType = format === 'png' ? 'image/png' : format === 'gif' ? 'image/gif' : 'image/jpeg'
      return this.compressPhoto(`data:${mimeType};base64,${photo.thumbnail}`)
    }))
  }

  deletePhoto(index: number): void {
    this.tabPhotos.update((photos) => {
      photos.splice(index, 1)
      return [...photos]
    })
  }

  async presentToast(message: string, color: 'success' | 'danger' | 'warning' = 'danger'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      color,
      duration: 1500,
      position: 'bottom',
    })
    await toast.present()
  }

  async searchMovies(): Promise<void> {
    this.error.set('')
    this.tmdbResults.set(null)
    if (!this.searchText().trim()) return
    this.refreshing.set(true)
    try {
      const results = await this.moviesService.searchMovies(this.searchText().trim())
      if (results) this.tmdbResults.set(results)
    } catch (error) {
      this.error.set(messageOf(error))
    } finally {
      this.refreshing.set(false)
    }
  }

  onSearchChange(value: string): void {
    this.searchText.set(value)
    this.tmdbResults.set(null)
  }

  async toggleFavorite(movie: Movie): Promise<void> {
    const profile = this.profile()
    if (!profile) return
    this.error.set('')
    try {
      const removingFavorite = this.favoriteIds().has(movie.id)
      const detailed = movie.tmdbId ? await this.moviesService.fetchDetails(movie) : movie
      this.favorites.set(await this.moviesService.setFavorite(profile, detailed, removingFavorite))
      await this.presentToast(
        removingFavorite ? 'Film retiré de vos favoris' : 'Film ajouté à vos favoris',
        'success',
      )
    } catch (error) {
      this.error.set(messageOf(error))
    }
  }

  async addMovie(form: NgForm): Promise<void> {
    const profile = this.profile()
    if (!profile || form.invalid) {
      form.control.markAllAsTouched()
      return
    }
    this.error.set('')
    try {
      if (this.inputKeyword.trim()) this.addKeyword()
      const value = form.value as { title: string; year?: number | string; overview?: string }
      await this.moviesService.addMovie(profile.uid, {
        title: value.title.trim(),
        year: value.year ? Number(value.year) : null,
        overview: value.overview?.trim() ?? '',
        posterPath: this.moviePoster(),
        genreIds: [],
        genres: this.tabKeywords,
        actorIds: [],
        actors: this.tabActors,
      })
      await this.presentToast('Film ajouté avec succès', 'success')
      form.resetForm()
      this.inputKeyword = ''
      this.tabKeywords = []
      this.inputActor = ''
      this.tabActors = []
      this.moviePoster.set(null)
      this.catalog.set(await this.moviesService.fetchCatalog())
    } catch (error) {
      this.error.set(messageOf(error))
    }
  }

  addKeyword(): void {
    const keyword = this.inputKeyword.trim()
    if (!keyword) {
      this.inputKeyword = ''
      return
    }
    if (!this.tabKeywords.some((item) => item.toLocaleLowerCase() === keyword.toLocaleLowerCase())) {
      this.tabKeywords.push(keyword)
    } else {
      void this.presentToast('Mot-clé existant', 'danger')
    }
    this.inputKeyword = ''
  }

  onKeywordKeyup(event: KeyboardEvent): void {
    if (event.key === ' ') this.addKeyword()
  }

  deleteKeyword(index: number): void {
    this.tabKeywords.splice(index, 1)
  }

  addActor(): void {
    const actor = this.inputActor.replace(/,$/, '').trim()
    if (!actor) {
      this.inputActor = ''
      return
    }
    if (this.tabActors.some((item) => item.toLocaleLowerCase() === actor.toLocaleLowerCase())) {
      void this.presentToast('Acteur déjà ajouté', 'danger')
    } else {
      this.tabActors.push(actor)
    }
    this.inputActor = ''
  }

  deleteActor(index: number): void {
    this.tabActors.splice(index, 1)
  }

  async toggleUserDisabled(user: UserProfile): Promise<void> {
    const db = this.firebase.db
    if (!db || user.uid === this.profile()?.uid) return
    this.error.set('')
    try {
      const disabled = !user.disabled
      const batch = writeBatch(db)
      batch.update(doc(db, 'users', user.uid), { disabled })
      batch.set(doc(db, 'matchProfiles', user.uid), { enabled: !disabled }, { merge: true })
      await batch.commit()
      this.adminUsers.update((users) => users.map((item) => item.uid === user.uid ? { ...item, disabled } : item))
    } catch (error) {
      this.error.set(messageOf(error))
    }
  }

  async changePage(page: Page): Promise<void> {
    this.page.set(page)
    if (page === 'matches') {
      await this.refreshData()
    } else if (page === 'admin' && this.isAdmin()) {
      try {
        await this.loadAdminUsers()
      } catch (error) {
        this.error.set(messageOf(error))
      }
    }
  }

  async logout(): Promise<void> {
    if (this.firebase.auth) await signOut(this.firebase.auth)
    this.page.set('discover')
    this.notice.set('')
  }

  async loadProfile(user: User): Promise<void> {
    const db = this.firebase.db
    if (!db) return
    this.loading.set(true)
    this.error.set('')
    try {
      const snapshot = await getDoc(doc(db, 'users', user.uid))
      if (!snapshot.exists()) {
        await signOut(this.firebase.auth!)
        throw new Error('Profil introuvable. Votre session a été fermée ; contactez un administrateur.')
      }
      const profile = { uid: user.uid, ...snapshot.data() } as UserProfile
      if (profile.disabled) {
        await signOut(this.firebase.auth!)
        this.error.set('Ce compte a été désactivé. Contactez un administrateur.')
        return
      }
      this.profile.set(profile)
      await this.refreshData()
    } catch (error) {
      this.error.set(messageOf(error))
    } finally {
      this.loading.set(false)
    }
  }

  async refreshData(): Promise<void> {
    const profile = this.profile()
    if (!profile) return
    this.refreshing.set(true)
    try {
      const [catalog, favorites] = await Promise.all([
        this.moviesService.fetchCatalog(),
        this.moviesService.fetchFavorites(profile.uid),
      ])
      await this.moviesService.syncMatchProfile(profile, favorites)
      const matches = await this.moviesService.fetchMatches(profile.uid)
      this.catalog.set(catalog)
      this.favorites.set(favorites)
      this.matchProfiles.set(matches)
    } catch (error) {
      this.error.set(messageOf(error))
    } finally {
      this.refreshing.set(false)
    }
  }

  posterUrl(path: string): string {
    return path.startsWith('http') || path.startsWith('data:')
      ? path
      : `https://image.tmdb.org/t/p/w500${path}`
  }

  private async compressPhoto(dataUrl: string): Promise<string> {
    const image = new Image()
    image.src = dataUrl
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Impossible de décoder cette image. Choisissez une autre photo.'))
    })

    const maxDimension = 320
    let scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('La compression de photo n’est pas disponible dans ce navigateur.')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.7, 0.55, 0.4]) {
        const compressed = canvas.toDataURL('image/jpeg', quality)
        if (compressed.length <= MAX_PHOTO_DATA_URL_LENGTH) return compressed
      }
      scale *= 0.75
    }
    throw new Error('Cette photo ne peut pas être compressée sous la limite Firestore. Essayez une image plus petite.')
  }

  private async loadAdminUsers(): Promise<void> {
    const snapshot = await getDocs(collection(this.firebase.requireDb(), 'users'))
    this.adminUsers.set(snapshot.docs.map((item) => ({ uid: item.id, ...item.data() }) as UserProfile))
  }
}
