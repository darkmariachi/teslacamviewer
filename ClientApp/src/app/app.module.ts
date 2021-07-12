import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { RouterModule } from '@angular/router';

import { AppComponent } from './app.component';
import { NavMenuComponent } from './nav-menu/nav-menu.component';
import { HomeComponent } from './home/home.component';
import { TeslaFolderListComponent } from './tesla-folder-list/tesla-folder-list.component';
import { TeslaFolderViewComponent } from './tesla-folder-view/tesla-folder-view.component';

import {VgCoreModule} from 'videogular2/compiled/core';
import {VgControlsModule} from 'videogular2/compiled/controls';
import {VgOverlayPlayModule} from 'videogular2/compiled/overlay-play';
import {VgBufferingModule} from 'videogular2/compiled/buffering';

import { MapViewComponent } from './map-view/map-view.component';
import { TeslaFolderFilterPipe } from './pipes/TeslaFolderFilterPipe';
import { NgPipesModule } from 'ngx-pipes';
import { OrderByButtonComponent } from './order-by-button/order-by-button.component';
import { LoginComponent } from './login/login.component';
import { InitialConfigComponent } from './initial-config/initial-config.component';
import { LoginGuard } from './services/login/login.guard';
import { AuthInterceptorService } from './auth-interceptor.service';
import { SettingsComponent } from './settings/settings.component';

@NgModule({
  declarations: [
    AppComponent,
    NavMenuComponent,
    HomeComponent,
    TeslaFolderListComponent,
    TeslaFolderViewComponent,
    MapViewComponent,
    TeslaFolderFilterPipe,
    OrderByButtonComponent,
    LoginComponent,
    InitialConfigComponent,
    SettingsComponent,
  ],
  imports: [
    BrowserModule.withServerTransition({ appId: 'ng-cli-universal' }),
    HttpClientModule,
    FormsModule,
    RouterModule.forRoot([
      { path: '', component: TeslaFolderListComponent, pathMatch: 'full', canActivate: [LoginGuard] },
      { path: 'folders/:folderType/:folderName', component: TeslaFolderViewComponent, canActivate: [LoginGuard]},
      { path: 'login', component: LoginComponent},
      { path: 'initialConfig', component: InitialConfigComponent},
      { path: 'settings', component: SettingsComponent, canActivate: [LoginGuard]}
    ]),
    VgCoreModule,
    VgControlsModule,
    VgOverlayPlayModule,
    VgBufferingModule,
    NgPipesModule,
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptorService, multi: true },
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
