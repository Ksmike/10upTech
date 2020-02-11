import { clearAllBodyScrollLocks, disableBodyScroll } from "body-scroll-lock";
import * as React from "react";
import { connect } from "react-redux";
import { Spinner } from "reactstrap";
import { enableSearch } from "../../config";
import { resetSearch, saveProjectOffset } from "../../store/actions";
import { IProject, IProjectCustomFields } from "../../store/definitions";
import { wordings } from "../../wordings/Wordings";
import Header from "../Common/Header/Header";
import Project, { IProjectProps } from "./Project/Project";
import "./ProjectPage.css";

interface IProjectPageProps {
  projects: IProjectProps[];
  loaded: boolean;
  myDisplayName: string;
  saveProjectOffset: (offset: number) => void;
  clearSearch: () => void;
  offset: number;
  unreads: any;
  customFields: IProjectCustomFields;
}

const mapStateToProps = (state: any, ownProps: any) => ({
  customFields: state.project.customFields,
  offset: state.project.offset,
});

const mapDispatchToProps = (dispatch: any) => ({
  clearSearch: () => resetSearch(dispatch),
  saveProjectOffset: (offset: number) => saveProjectOffset(dispatch, offset),
});

class ProjectPage extends React.Component<IProjectPageProps, any> {
  private targetElement: HTMLElement | null = null;
  private projectPageRef: any = React.createRef();

  public componentDidMount() {
    this.props.clearSearch();
    this.targetElement = document.querySelector("#scrollable");
    if (this.targetElement) {
      disableBodyScroll(this.targetElement);
    }
    this.projectPageRef.current.scrollTop = this.props.offset;
  }

  public componentWillUnmount() {
    clearAllBodyScrollLocks();
  }

  public render() {
    return (
      <div className="project-page" id="scrollable" ref={this.projectPageRef}>
        <Header
          showLogo={true}
          hideBackButton={true}
          searchButton={enableSearch}
          showMenu={true}
        />
        {this.renderContent()}
      </div>
    );
  }

  private renderContent = () => {
    if (this.props.projects.length > 0) {
      return this.showProjects();
    } else if (this.props.loaded) {
      return (
        <div className="fullscreen-container">
          {wordings.currentLang.noProjectsAvailable}
        </div>
      );
    }
    return (
      <div className="fullscreen-container">
        <Spinner />
      </div>
    );
  }

  private showProjects = () => {
    let projectButtons: JSX.Element[] = [];
    projectButtons = this.props.projects.map((e: IProject, i: number) => {
      return (
        <Project
          key={`project-${e.id}`}
          myDisplayName={this.props.myDisplayName}
          saveProjectOffset={this.saveProjectOffset}
          unread={this.props.unreads[e.id]}
          cmId={
            this.props.customFields[e.id]
              ? this.props.customFields[e.id].cmId
              : ""
          }
          consultationId={
            this.props.customFields[e.id]
              ? this.props.customFields[e.id].consultationId
              : ""
          }
          {...e}
        />
      );
    });

    return projectButtons;
  }

  private saveProjectOffset = () =>
    this.props.saveProjectOffset(this.projectPageRef.current.scrollTop)
}

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(ProjectPage);
