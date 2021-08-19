import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ConfigurationModel } from '../models/ConfigurationModel';
import { LoginService } from '../services/login/login.service';

@Component({
  selector: 'app-initial-config',
  templateUrl: './initial-config.component.html',
  styleUrls: ['./initial-config.component.css']
})
export class InitialConfigComponent implements OnInit {

  config: ConfigurationModel = new ConfigurationModel();
  error: string;
  constructor(
    private loginService: LoginService,
    private router: Router) { }

  ngOnInit() {
  }
  
  start() {
    if (!this.config.password || !this.config.repeatpassword ) {
      this.error = "Password can't be empty";
      return;
    }
    if (this.config.password !== this.config.repeatpassword) {
      this.error = "Passwords do not match."
      return;
    }

    this.loginService.initializeConfig(this.config)
    .subscribe(res => {
      this.router.navigate(['login']);
    }, (err) => {
      this.error = err;
    });
  }

}
