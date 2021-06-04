import { Component, Input, OnInit } from '@angular/core';

@Component({
  selector: 'order-by-button',
  templateUrl: './order-by-button.component.html',
  styleUrls: ['./order-by-button.component.css']
})
export class OrderByButtonComponent implements OnInit {

  @Input() isOrderedByProperty: boolean;
  @Input() isReversed: boolean;
  constructor() { }

  ngOnInit() {
  }

}
