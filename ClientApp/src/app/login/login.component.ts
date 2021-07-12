import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ConfigService } from '../services/config/config.service';
import { LoginService } from '../services/login/login.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {

  password = '';
  error: string;

  constructor(
    private configService: ConfigService,
    private router: Router,
    private loginService: LoginService
    ) { }

  ngOnInit() {
    this.configService.getConfig()
    .subscribe(c => {
      if (!c) {
        this.router.navigate(['initialConfig']);
      }
    });
  }

  login() {
    this.loginService.login(this.password)
    .subscribe(error => {
      if (error) {
        this.error = error.error;
      }
      else {
        this.router.navigate(['']);
      }
    })
  }

  logout() {
    this.loginService.logout();
  }

  get isLoggedIn(): boolean {
    return this.loginService.isLoggedIn;
  }

}
