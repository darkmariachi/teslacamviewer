import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { InitialConfigComponent } from 'src/app/initial-config/initial-config.component';
import { LoginComponent } from 'src/app/login/login.component';
import { LoginService } from './login.service';

@Injectable({
  providedIn: 'root'
})
export class LoginGuard implements CanActivate {
  constructor(
    private loginService: LoginService,
    private router: Router) {

  }
  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    if (next.component instanceof InitialConfigComponent) {
      return true;
    }
    if(!this.loginService.isLoggedIn) {
      return this.router.parseUrl('login');
    }
    return true;
  }
  
}
