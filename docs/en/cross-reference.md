---
title: Parameters & FET Cross-Reference
description: Comprehensive technical cross-reference mapping Eurario's educational parameters to the compiled XML constraints of the native FET heuristic solver.
---

# 🔬 Cross-Reference: Eurario Parameters & FET XML Constraints

Eurario's timetabling solver is powered by the official high-performance native **FET** (*Free Timetabling Software*) engine.

This document details the exact, bi-directional mapping between pedagogical parameters configured in the Eurario user interface and the compiled XML tags fed to the FET engine ([Official FET Documentation](https://www.timetabling.de/manual/FET-manual.en.html)).

---

## 1. Core Entity Mapping

| Eurario Concept | FET XML Entity | Attributes & Architectural Notes |
| :--- | :--- | :--- |
| **Teacher** | `<Teacher>` | Identified uniquely by `<Name>`. Embeds competition codes and contract hours in comments. |
| **Standard Class** | `<Year>` | Represents a student cohort (e.g. `1A`, `3B`, `5CSA`). In FET, this defines the highest-level student grouping. |
| **Academic Track / Articulation** | `<Group>` | A subgroup of a class sharing common courses but diverging for specialized tracks (e.g. `3A_INFO`, `3A_TEL`). |
| **Language Group / Lab Subgroup** | `<Subgroup>` | An atomic student division for split classes (e.g. `1A_FRA`, `1A_SPA`). |
| **Subject** | `<Subject>` | Curricular academic subject. When assigned a `short_name`, the abbreviation is used for printed reports while the canonical name is preserved in FET. |
| **Teaching Allocation (Cattedra)** | `<Activity>` Group | Decomposed into convex sub-activities tied together by the same `<Activity_Group_Id>`. |
| **School Campus / Building** | `<Building>` | Physical school facility (e.g., *Main Campus*, *Branch Campus*). |
| **Room / Laboratory** | `<Room>` | Physical space tied to a `<Building>` with a maximum seating `<Capacity>`. |

---

## 2. Teacher Time Constraints (`Time_Constraints_List`)

### A. Contractual Day Off & Hourly Unavailabilities
* **Eurario Interface**: Teacher Profile &rarr; *Availability Tab* &rarr; Weekly clickable grid (days x periods).
* **FET XML Tag**: `<ConstraintTeacherNotAvailableTimes>`
* **Generated XML**:
  ```xml
  <ConstraintTeacherNotAvailableTimes>
    <Weight_Percentage>100</Weight_Percentage>
    <Teacher_Name>Rossi Mario</Teacher_Name>
    <Number_of_Not_Available_Times>6</Number_of_Not_Available_Times>
    <Not_Available_Time>
      <Day>Sat</Day>
      <Hour>1</Hour>
    </Not_Available_Time>
    <!-- ... periods 1 to 6 for the contractual day off -->
  </ConstraintTeacherNotAvailableTimes>
  ```
* **Solver Impact**: Hard constraint (100% weight). FET strictly prohibits placing any teaching activity in marked slots.

### B. Maximum and Minimum Working Days per Week
* **Eurario Interface**: Teacher Modal &rarr; *Active Days per Week* (`min_days` and `max_days`).
* **FET XML Tags**:
  * `<ConstraintTeacherMaxDaysPerWeek>`
  * `<ConstraintTeacherMinDaysPerWeek>`
* **Generated XML**:
  ```xml
  <ConstraintTeacherMaxDaysPerWeek>
    <Weight_Percentage>100</Weight_Percentage>
    <Teacher_Name>Bianchi Laura</Teacher_Name>
    <Max_Days_Per_Week>4</Max_Days_Per_Week>
  </ConstraintTeacherMaxDaysPerWeek>
  <ConstraintTeacherMinDaysPerWeek>
    <Weight_Percentage>100</Weight_Percentage>
    <Teacher_Name>Bianchi Laura</Teacher_Name>
    <Min_Days_Per_Week>3</Min_Days_Per_Week>
  </ConstraintTeacherMinDaysPerWeek>
  ```
* **Practical Use**: Essential for part-time schedules (e.g., a teacher present exclusively on 3 or 4 days) and eliminating isolated 1-hour days.

### C. Free Period Windows (Daily & Weekly Gap Hours)
* **Eurario Interface**: School Settings &rarr; *Max daily gaps* (default 1) and *Max weekly gaps* (default 2-3).
* **FET XML Tags**:
  * `<ConstraintTeacherMaxGapsPerDay>` (95-100% weight)
  * `<ConstraintTeacherMaxGapsPerWeek>` (95-100% weight)
* **Generated XML**:
  ```xml
  <ConstraintTeacherMaxGapsPerDay>
    <Weight_Percentage>98</Weight_Percentage>
    <Teacher_Name>Verdi Giuseppe</Teacher_Name>
    <Max_Gaps>1</Max_Gaps>
  </ConstraintTeacherMaxGapsPerDay>
  <ConstraintTeacherMaxGapsPerWeek>
    <Weight_Percentage>95</Weight_Percentage>
    <Teacher_Name>Verdi Giuseppe</Teacher_Name>
    <Max_Gaps>2</Max_Gaps>
  </ConstraintTeacherMaxGapsPerWeek>
  ```

### D. Daily Minimum and Maximum Teaching Limits
* **Eurario Interface**: Timetable Settings &rarr; *Max daily teaching hours* and *Min hours on working days*.
* **FET XML Tags**:
  * `<ConstraintTeacherMaxHoursDaily>`: Limits daily teaching load to 4 or 5 hours.
  * `<ConstraintTeacherMinHoursDaily>`: Enforces a minimum of 2 hours on active days to prevent uneconomic trips for a single lecture.
  * `<ConstraintTeacherMaxSpanPerDay>`: Caps the overall daily span between the first and last period on campus.

---

## 3. Student & Class Time Constraints

### A. Compact Student Timetables (Zero Gap Hours)
* **Eurario Interface**: Active by default for all student classes.
* **FET XML Tags**:
  * `<ConstraintStudentsMaxGapsPerDay>`: `<Max_Gaps>0</Max_Gaps>` (100% weight)
  * `<ConstraintStudentsMaxGapsPerWeek>`: `<Max_Gaps>0</Max_Gaps>` (100% weight)
* **Solver Effect**: Strictly guarantees that students never have unsupervised idle gaps between classes.

### B. Delayed Starts at Second Period
* **Eurario Interface**: School Settings &rarr; *Maximum late starts per week*.
* **FET XML Tag**: `<ConstraintStudentsEarlyMaxBeginningsAtSecondHour>`
* **Generated XML**:
  ```xml
  <ConstraintStudentsEarlyMaxBeginningsAtSecondHour>
    <Weight_Percentage>100</Weight_Percentage>
    <Max_Beginnings_At_Second_Hour>0</Max_Beginnings_At_Second_Hour>
  </ConstraintStudentsEarlyMaxBeginningsAtSecondHour>
  ```
* **Solver Effect**: When set to 0, enforces that every class always begins its school day at period 1.

### C. Recesses & School Breaks
* **Eurario Interface**: Schedule Settings &rarr; *Recess Intervals*.
* **FET XML Tag**: `<ConstraintBreakTimes>`
* **Solver Effect**: Bars any lesson from being scheduled during designated school-wide breaks.

---

## 4. Subject Constraints & Sub-Activity Splitting

### A. Spacing Between Lessons of the Same Subject
* **Eurario Interface**: Automatically compiled for every multi-block subject (e.g. `2+1+1`).
* **FET XML Tag**: `<ConstraintMinDaysBetweenActivities>`
* **Generated XML**:
  ```xml
  <ConstraintMinDaysBetweenActivities>
    <Weight_Percentage>98</Weight_Percentage>
    <Consecutive_If_Same_Day>true</Consecutive_If_Same_Day>
    <Number_of_Activities>3</Number_of_Activities>
    <Activity_Id>101</Activity_Id>
    <Activity_Id>102</Activity_Id>
    <Activity_Id>103</Activity_Id>
    <MinDays>1</MinDays>
  </ConstraintMinDaysBetweenActivities>
  ```
* **Solver Effect**: Distributes sub-activities across different days of the week, ensuring that if two activities ever fall on the same day, they must run consecutively (`Consecutive_If_Same_Day=true`).

### B. Preferred Time Slots (Early vs Late Periods)
* **Eurario Interface**: Subject Modal &rarr; *Preferred Time Slot* (`PRIME`, `ULTIME`, `INDIFFERENTE`).
* **FET XML Tag**: `<ConstraintActivitiesPreferredTimeSlots>`
* **Configuration**:
  * `PRIME`: Prioritizes periods 1, 2, and 3 (ideal for written tests, Mathematics, Latin).
  * `ULTIME`: Prioritizes period 4, 5, and afternoons (ideal for Physical Education, Arts, and Labs).

### C. Afternoon Return Exclusions (`no_rientri`)
* **Eurario Interface**: Subject Modal &rarr; *Exclude from Afternoon Sessions*.
* **FET XML Tag**: `<ConstraintActivitiesPreferredTimeSlots>` configured with strict prohibitions against afternoon periods (7th and 8th hour).

### D. Manually Pinned / Locked Activities
* **Eurario Interface**: Lock icon on timetable grid.
* **FET XML Tag**: `<ConstraintActivityPreferredStartingTime>` (100% weight). Permanently fixes the day and period.

---

## 5. Spatial & Multi-Building Constraints (`Space_Constraints_List`)

### A. Home Room Assignment
* **Eurario Interface**: Class Modal &rarr; *Home Room*.
* **FET XML Tag**: `<ConstraintStudentsSetHomeRoom>`
* **Generated XML**:
  ```xml
  <ConstraintStudentsSetHomeRoom>
    <Weight_Percentage>100</Weight_Percentage>
    <Students>3A</Students>
    <Room>Room 204</Room>
  </ConstraintStudentsSetHomeRoom>
  ```

### B. Shared Labs & Gymnasiums
* **Eurario Interface**: Allocation Modal &rarr; *Laboratory / Gymnasium*.
* **FET XML Tag**: `<ConstraintActivityPreferredRooms>`
* **Generated XML**:
  ```xml
  <ConstraintActivityPreferredRooms>
    <Weight_Percentage>100</Weight_Percentage>
    <Activity_Id>205</Activity_Id>
    <Number_of_Preferred_Rooms>1</Number_of_Preferred_Rooms>
    <Preferred_Room>Comp_Lab_1</Preferred_Room>
  </ConstraintActivityPreferredRooms>
  ```

### C. Commuting Between Campuses (Main & Branch)
* **Eurario Interface**: Campus Settings & Travel Times.
* **FET XML Tags**:
  1. `<ConstraintTeachersMaxBuildingChangesPerDay>`: Caps campus changes per day (typically max 1).
  2. `<ConstraintTeachersMaxBuildingChangesPerWeek>`: Caps campus changes across the entire week (typically max 2 or 3).
  3. `<ConstraintTeachersMinGapsBetweenBuildingChanges>`: Enforces a required travel gap (e.g. 1 free hour) between lessons held in different buildings.

---

## 6. Output Comparison: Raw FET vs Eurario

<div class="doc-figure">
  <img src="../assets/fet-interfaccia.png" alt="Official desktop graphical interface of the FET solver engine" class="doc-screenshot">
  <div class="doc-caption">Figure 4.1: Official desktop user interface of FET, featuring menus for time constraints, space constraints, and schedule computation.</div>
</div>

| Capability | Raw Native FET Output | Eurario Experience |
| :--- | :--- | :--- |
| **Assignment Overview** | Fragmented atomic sub-activities | Unified view per teacher and class with compact block badges |
| **Multi-Campus Logistics** | Textual warning logs | Colored badges for Central/Branch with commuting alerts |
| **On-Duty & Substitutes** | Unsupported (requires dummy activities) | Dedicated greedy gap-filling and substitute balancing engine |
| **Post-Solve Adjustments** | Full recalculation required | Interactive Drag & Drop grid with real-time collision checks |
| **Master Outputs** | Raw static HTML tables | Word (.docx) A3 Landscape (Procedura 12) & typographic PDFs |
