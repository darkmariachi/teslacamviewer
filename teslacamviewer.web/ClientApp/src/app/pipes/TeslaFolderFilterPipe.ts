import { Pipe, PipeTransform } from "@angular/core";
import { TeslaFolder } from "../models/TeslaFolder";

@Pipe({name:"folderFilter"})
export class TeslaFolderFilterPipe implements PipeTransform {
    transform(items: TeslaFolder[], term: string): any {
        // I am unsure what id is here. did you mean title?
        return items.filter(item => 
            item.name.toLowerCase().indexOf(term.toLowerCase()) !== -1 ||
            item.teslaEvent.reason.toLowerCase().indexOf(term.toLowerCase()) !== -1 ||
            item.teslaEvent.city.toLowerCase().indexOf(term.toLowerCase()) !== -1 ||
            new Date(item.teslaEvent.timeStamp).toDateString().toLowerCase().indexOf(term.toLowerCase()) !== -1
            );
    }
}