import { Component } from '@angular/core';
import { LoginService } from '../services/login/login.service';

@Component({
  selector: 'app-nav-menu',
  templateUrl: './nav-menu.component.html',
  styleUrls: ['./nav-menu.component.css']
})
export class NavMenuComponent {
  isExpanded = false;

  constructor(private loginService: LoginService) {

  }

  isLoggedIn() {
    return this.loginService.isLoggedIn;
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
