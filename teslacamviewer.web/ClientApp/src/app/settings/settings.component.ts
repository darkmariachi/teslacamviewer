import { Component, OnInit } from '@angular/core';
import { ChangePasswordModel } from '../models/ChangePasswordModel';
import { ValidationError } from '../models/ValidationError';
import { ConfigService } from '../services/config/config.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit {

  changePassword: ChangePasswordModel = new ChangePasswordModel();
  err: ValidationError;
  success: string;
  constructor(private configService: ConfigService) { }

  ngOnInit() {
  }

  doChangePassword(){
    this.err = null;
    this.success = null;
    if (!this.changePassword.currentpassword || !this.changePassword.newpassword || !this.changePassword.repeatnewpassword) {
      this.err = { message: "No fields should be left blank." } as ValidationError;
      return;
    }
    if (this.changePassword.newpassword !== this.changePassword.repeatnewpassword) {
      this.err =  {message: "New password does not match"} as ValidationError;
      return;
    }
    this.configService.changePassword(this.changePassword)
    .subscribe(res => {
        this.success = "Changed the password successfully";
    }, (err) => {
        this.err = { message: err.error } as ValidationError;
    });

  }

}
