import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { OrderByButtonComponent } from './order-by-button.component';

describe('OrderByButtonComponent', () => {
  let component: OrderByButtonComponent;
  let fixture: ComponentFixture<OrderByButtonComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ OrderByButtonComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(OrderByButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
