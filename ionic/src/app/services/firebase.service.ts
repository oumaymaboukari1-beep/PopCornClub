import { Injectable } from '@angular/core'
import { initializeApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { environment } from '../../environments/environment'

const config = environment.firebase
const configured = Object.values(config).every(Boolean)
const firebaseApp = configured ? initializeApp(config) : null

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  readonly configured = configured
  readonly auth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null
  readonly db: Firestore | null = firebaseApp ? getFirestore(firebaseApp) : null

  requireDb(): Firestore {
    if (!this.db) throw new Error('Firebase n’est pas configuré.')
    return this.db
  }
}
