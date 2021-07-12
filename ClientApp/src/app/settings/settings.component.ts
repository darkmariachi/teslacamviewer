import { Component, OnInit } from '@angular/core';
import { ChangePasswordModel } from '../models/ChangePasswordModel';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit {

  changePassword: ChangePasswordModel = new ChangePasswordModel();
  constructor() { }

  ngOnInit() {
  }

  doChangePassword(){
    console.log(this.changePassword);
  }

}
