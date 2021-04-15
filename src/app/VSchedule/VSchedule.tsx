import React, {useState, useEffect, useReducer} from 'react';
import { PageSection, Title } from '@patternfly/react-core';
import $ from 'jquery';
import L from 'leaflet';
import moment from 'moment';
import oplogo from '@app/bgimages/optaPlannerLogo200px.png';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'leaflet/dist/leaflet.css';
import { Tabs, Tab, TabTitleText, Checkbox } from '@patternfly/react-core';

var vSchedulerHost = process.env.VACCINATION_SCHEDULER_HOST;
if(typeof vSchedulerHost === 'undefined') {
  vSchedulerHost = "v-scheduler";
}
console.log("VACCINATION_SCHEDULER_HOST = "+vSchedulerHost);

var autoRefreshIntervalId = null;
var vaccineCenterLeafletGroup = null;
var personLeafletGroup = null;
var lineIndex = 0;

const timeslotStyle = {
  float: 'right'
};

const cardStyle = (color) => {
  backgroundColor: color
}

function refreshSolution() {
  console.log("refreshSolution ... ");
  $.getJSON("http://"+vSchedulerHost+":8080/vaccinationSchedule", function (solution) {
    refreshSolvingButtons(solution.solverStatus != null && solution.solverStatus !== "NOT_SOLVING");
    $("#score").text("Score: " + (solution.score == null ? "?" : solution.score));

    const vaccineTypesDiv = $("#vaccineTypes");
    vaccineTypesDiv.children().remove();
    solution.vaccineTypeList.forEach((vaccineType) => {
      const color = pickColor(vaccineType);
      vaccineTypesDiv.append($(`<div class="card style="background-color: ${color}" />`)
          .append($(`<div class="card-body p-2"/>`)
            .append($(`<h5 class="card-title mb-0"/>`).text(vaccineTypeToString(vaccineType)))));
    });

    const scheduleTable = $("#scheduleTable");
    scheduleTable.children().remove();
    const unassignedPersonsDiv = $("#unassignedPersons");
    unassignedPersonsDiv.children().remove();

    const thead = $("<thead>").appendTo(scheduleTable);
    const headerRow = $("<tr>").appendTo(thead);
    headerRow.append($("<th>Timeslot</th>"));
    solution.vaccinationCenterList.forEach((vaccinationCenter) => {
      for (lineIndex = 0; lineIndex < vaccinationCenter.lineCount; lineIndex++) {
        headerRow
          .append($("<th/>")
            .append($("<span/>").text(vaccinationCenter.name + " " + lineIndex)));
      }
    });

    const injectionMap = new Map(solution.injectionList
      .map(injection => [injection.dateTime + "/" + injection.vaccinationCenter.name + "/" + injection.lineIndex, injection]));
    var personIdToInjectionMap = new Map();
    solution.injectionList.forEach((injection) => {
      if (injection.person != null) {
        personIdToInjectionMap.set(injection.person.id, injection);
      }
    });

    const tbody = $(`<tbody>`).appendTo(scheduleTable);
    var previousParsedDateTime = null;
    solution.timeslotDateTimeList.forEach((dateTime) => {
      const row = $(`<tr>`).appendTo(tbody);
      var parsedDateTime = moment(dateTime, "YYYY,M,D,H,m");
      var showDate = (previousParsedDateTime == null || !parsedDateTime.isSame(previousParsedDateTime, "day"));
      row
        .append($(`<th class="align-middle"/>`)
          .append($(`<span style={timeslotStyle} />`).text(showDate ? parsedDateTime.format("ddd MMM D HH:mm") : parsedDateTime.format("HH:mm"))));
      previousParsedDateTime = parsedDateTime;
      solution.vaccinationCenterList.forEach((vaccinationCenter) => {
        for (lineIndex = 0; lineIndex < vaccinationCenter.lineCount; lineIndex++) {
          var injection = injectionMap.get(dateTime + "/" + vaccinationCenter.name + "/" + lineIndex);
          if (injection == null) {
            row.append($(`<td class="p-1"/>`));
          } else {
            const color = pickColor(injection.vaccineType);
            var cardBody = $(`<div class="card-body pt-1 pb-1 pl-2 pr-2"/>`);
            if (injection.person == null) {
              cardBody.append($(`<h5 class="card-title mb-0"/>`).text("Unassigned"));
            } else {
              cardBody.append($(`<h5 class="card-title mb-1"/>`)
                .text(injection.person.name + " (" + injection.person.age + ")"));
              if (injection.person.age >= 55 && injection.vaccineType === "ASTRAZENECA") {
                cardBody.append($(`<p class="badge badge-danger mb-0"/>`).text("55+ has " + vaccineTypeToString(injection.vaccineType)));
              }
              if (!injection.person.firstShotInjected) {
                cardBody.append($(`<p class="card-text ml-2 mb-0"/>`).text("1th shot"));
              } else {
                var idealDateDiff = moment(injection.dateTime, "YYYY,M,D,H,m").diff(moment(injection.person.secondShotIdealDate, "YYYY,M,D"), 'days');
                cardBody.append($(`<p class="card-text ml-2 mb-0"/>`).text("2nd shot ("
                  + (idealDateDiff === 0 ? "ideal day"
                    : (idealDateDiff < 0 ? (-idealDateDiff) + " days too early"
                      : idealDateDiff + " days too late")) + ")"));
                if (injection.vaccineType !== injection.person.firstShotVaccineType) {
                  cardBody.append($(`<p class="badge badge-danger ml-2 mb-0"/>`).text("First shot was " + vaccineTypeToString(injection.person.firstShotVaccineType)));
                }
              }
            }
            row.append($(`<td class="p-1"/>`)
              .append($(`<div class="card" style="background-color: ${color}" />`)
                .append(cardBody)));
          }
        }
      });
    });


    vaccineCenterLeafletGroup.clearLayers();
    solution.vaccinationCenterList.forEach((vaccinationCenter) => {
      L.marker(vaccinationCenter.location).addTo(vaccineCenterLeafletGroup);
    });

    personLeafletGroup.clearLayers();
    solution.personList.forEach((person) => {
      const injection = personIdToInjectionMap.get(person.id);
      const personColor = (injection == null ? "gray" : pickColor(injection.vaccineType));
      L.circleMarker(person.homeLocation, {radius: 4, color: personColor, weight: 2}).addTo(personLeafletGroup);
      if (injection != null) {
        L.polyline([person.homeLocation, injection.vaccinationCenter.location], {color: personColor, weight: 1}).addTo(personLeafletGroup);
      } else {
        unassignedPersonsDiv.append($(`<div class="card"/>`)
            .append($(`<div class="card-body pt-1 pb-1 pl-2 pr-2"/>`)
              .append($(`<h5 class="card-title mb-1"/>`).text(person.name + " (" + person.age + ")"))
              .append($(`<p class="card-text ml-2"/>`).text(
                person.firstShotInjected
                ? "2nd shot (ideally " + moment(person.secondShotIdealDate, "YYYY,M,D").format("ddd MMM D") + ")"
                : "1th shot"))));
      }
    });
  });
}

function vaccineTypeToString(vaccineType) {
  switch (vaccineType) {
    case "PFIZER":
      return "Pfizer";
    case "MODERNA":
      return "Moderna";
    case "ASTRAZENECA":
      return "AstraZeneca";
    default:
      return vaccineType;
  }
}

function solve() {
  $.post("http://"+vSchedulerHost+":8080/vaccinationSchedule/solve", function () {
    refreshSolvingButtons(true);
  }).fail(function (xhr, ajaxOptions, thrownError) {
    showError("Start solving failed.", xhr);
  });
}

function refreshSolvingButtons(solving) {
  if (solving) {
    $("#solveButton").hide();
    $("#stopSolvingButton").show();
    if (autoRefreshIntervalId == null) {
      autoRefreshIntervalId = setInterval(refreshSolution, 2000);
    }
  } else {
    $("#solveButton").show();
    $("#stopSolvingButton").hide();
    if (autoRefreshIntervalId != null) {
      clearInterval(autoRefreshIntervalId);
      autoRefreshIntervalId = null;
    }
  }
}

function stopSolving() {
  try {
    console.log("stopSolving() ");
    $.ajax({
      url: "http://"+vSchedulerHost+":8080/vaccinationSchedule/stopSolving", 
      type: 'post',
      success: function () {
        refreshSolvingButtons(false);
        refreshSolution();
      },
      error: function(xhr, ajaxOptions, error){
        const serverErrorMessage = !xhr.responseJSON ? `${xhr.status}: ${xhr.statusText}` : xhr.responseJSON.message;
        console.error("stopSolving() serverErrorMessage = "+serverErrorMessage);
      }
    });
  }catch(e) {
    console.error("stopSolving() exception = "+e);
  }
}

function showError(title, xhr) {
  const serverErrorMessage = !xhr.responseJSON ? `${xhr.status}: ${xhr.statusText}` : xhr.responseJSON.message;
  console.error(title + "\n" + serverErrorMessage);
}

$(document).ready(function () {
  console.log("document.ready() ..... ");
  $.ajaxSetup({
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    }
  });
  $.each(["put", "delete"], function (i, method) {
    $[method] = function (url, data, callback, type) {
      if ($.isFunction(data)) {
        type = type || callback;
        callback = data;
        data = undefined;
      }
      return $.ajax({
        url: url,
        type: method,
        dataType: type,
        data: data,
        success: callback
      });
    };
  });

  $("#refreshButton").click(function () {
    refreshSolution();
  });
  $("#solveButton").click(function () {
    solve();
  });
  $("#stopSolvingButton").click(function () {
    stopSolving();
  });

  const leafletMap = L.map("leafletMap", { doubleClickZoom: false }).setView([33.75, -84.40], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
  }).addTo(leafletMap);
  $(`a[data-toggle="tab"]`).on("shown.bs.tab", function (e) {
    leafletMap.invalidateSize();
  })

  vaccineCenterLeafletGroup = L.layerGroup();
  vaccineCenterLeafletGroup.addTo(leafletMap);
  personLeafletGroup = L.layerGroup();
  personLeafletGroup.addTo(leafletMap);

  refreshSolution();
});

// ****************************************************************************
// TangoColorFactory
// ****************************************************************************

const SEQUENCE_1 = [0x8AE234, 0xFCE94F, 0x729FCF, 0xE9B96E, 0xAD7FA8];
const SEQUENCE_2 = [0x73D216, 0xEDD400, 0x3465A4, 0xC17D11, 0x75507B];

var colorMap = new Map;
var nextColorCount = 0;

function pickColor(object) {
  let color = colorMap[object];
  if (color !== undefined) {
    return color;
  }
  color = nextColor();
  colorMap[object] = color;
  return color;
}

function nextColor() {
  let color;
  let colorIndex = nextColorCount % SEQUENCE_1.length;
  let shadeIndex = Math.floor(nextColorCount / SEQUENCE_1.length);
  if (shadeIndex === 0) {
    color = SEQUENCE_1[colorIndex];
  } else if (shadeIndex === 1) {
    color = SEQUENCE_2[colorIndex];
  } else {
    shadeIndex -= 3;
    let floorColor = SEQUENCE_2[colorIndex];
    let ceilColor = SEQUENCE_1[colorIndex];
    let base = Math.floor((shadeIndex / 2) + 1);
    let divisor = 2;
    while (base >= divisor) {
      divisor *= 2;
    }
    base = (base * 2) - divisor + 1;
    let shadePercentage = base / divisor;
    color = buildPercentageColor(floorColor, ceilColor, shadePercentage);
  }
  nextColorCount++;
  return "#" + color.toString(16);
}

function buildPercentageColor(floorColor, ceilColor, shadePercentage) {
  let red = (floorColor & 0xFF0000) + Math.floor(shadePercentage * ((ceilColor & 0xFF0000) - (floorColor & 0xFF0000))) & 0xFF0000;
  let green = (floorColor & 0x00FF00) + Math.floor(shadePercentage * ((ceilColor & 0x00FF00) - (floorColor & 0x00FF00))) & 0x00FF00;
  let blue = (floorColor & 0x0000FF) + Math.floor(shadePercentage * ((ceilColor & 0x0000FF) - (floorColor & 0x0000FF))) & 0x0000FF;
  return red | green | blue;
}

const VSchedule: React.FunctionComponent = () => {

  const [activeTabKey, setActiveTabKey] = useState(0);

  const handleTabClick = (event, tabIndex) => {
    setActiveTabKey(tabIndex);
  }

  return (

    <div className="container-fluid">
      <nav className="navbar navbar-expand-lg navbar-light bg-light">
        <a className="navbar-brand" href="https://www.optaplanner.org">
          <img src={oplogo} alt="OptaPlanner logo" />
        </a>
      </nav>
      <div className="sticky-top d-flex justify-content-center align-items-center" aria-live="polite" aria-atomic="true">
        <div id="notificationPanel" ></div>
      </div>
      <h1>Vaccination scheduler</h1>
      <p>Generate the optimal schedule to inject a country with COVID-19 vaccines.</p>
      <div>
        <button id="refreshButton" type="button" className="btn btn-secondary">
          <span className="fas fa-refresh"></span> Refresh
        </button>
        <button id="solveButton" type="button" className="btn btn-success">
          <span className="fas fa-play"></span> Solve
        </button>
        <button id="stopSolvingButton" type="button" className="btn btn-danger">
          <span className="fas fa-stop"></span> Stop solving
        </button>
        <span id="score" className="score ml-2 align-middle font-weight-bold">Score: ?</span>
        <div>
          <div className="ml-5 mr-5">
            <span>Vaccine types:</span>
            <div id="vaccineTypes" className="card-columns"></div>
          </div>
          <Tabs activeKey={activeTabKey} onSelect={handleTabClick} isBox={true}>
            <Tab eventKey={0} title={<TabTitleText>Schedule</TabTitleText>}>
                <table className="table table-borderless table-striped" id="scheduleTable">
                </table>
            </Tab>
            <Tab eventKey={1} title={<TabTitleText>Map</TabTitleText>}>
                <div id="leafletMap" ></div>
            </Tab>
            <Tab eventKey={2} title={<TabTitleText>Unassigned</TabTitleText>}>
                <h2>Unassigned persons</h2>
                <div id="unassignedPersons" className="card-columns"></div>
            </Tab>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

export { VSchedule };
