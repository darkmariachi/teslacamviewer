import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { first, map } from 'rxjs/operators';
import { InitialConfigComponent } from 'src/app/initial-config/initial-config.component';
import { LoginComponent } from 'src/app/login/login.component';
import { ConfigService } from '../config/config.service';
import { LoginService } from './login.service';

@Injectable({
  providedIn: 'root'
})
export class LoginGuard implements CanActivate {
  constructor(
    private loginService: LoginService,
    private router: Router,
    private configService: ConfigService) {

  }
  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    return new Observable(subscriber => {
      this.configService.authEnabled$.pipe<boolean | UrlTree>(map(isAuthorizationEnabled => {
        if (isAuthorizationEnabled) {
          if (next.component instanceof InitialConfigComponent) {
            return true;
          }
          if (!this.loginService.isLoggedIn) {
            return this.router.parseUrl('login');
          }
        }
        return true;
      })).subscribe(res => subscriber.next(res));
    });
       
  }

}
