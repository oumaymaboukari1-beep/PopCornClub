import { bootstrapApplication } from '@angular/platform-browser'
import { AppComponent } from './app/app.component'
import { appConfig } from './app/app.config'
import { defineCustomElements } from '@ionic/pwa-elements/loader'
import { register } from 'swiper/element/bundle'

register()
void defineCustomElements(window)
bootstrapApplication(AppComponent, appConfig)
  .catch((error: unknown) => console.error(error))
