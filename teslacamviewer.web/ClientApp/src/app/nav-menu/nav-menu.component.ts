import { Component } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { ConfigService } from '../services/config/config.service';
import { LoginService } from '../services/login/login.service';

@Component({
  selector: 'app-nav-menu',
  templateUrl: './nav-menu.component.html',
  styleUrls: ['./nav-menu.component.css']
})
export class NavMenuComponent {
  isExpanded = false;

  constructor(
    private loginService: LoginService,
    private configService: ConfigService) {
  }

  isLoggedIn(): Observable<boolean> {
    return this.configService.authEnabled$.pipe(map(authEnabled => {
      return authEnabled && this.loginService.isLoggedIn;
    }));
  }

  authRequired(): Subject<boolean> {
    return this.configService.authEnabled$;
  }

  logout() {
    this.loginService.logout();
  }

  collapse() {
    this.isExpanded = false;
  }

  toggle() {
    this.isExpanded = !this.isExpanded;
  }
}
